import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createProject, MAX_IMPORT_BYTES, parseProject, serializeProject } from '../src/io/project.ts'
import type { PaperProject } from '../src/io/project.ts'
import { SceneStore } from '../src/scene/store.ts'
import { basicInfo, executeTransaction, exportCanvas, IdempotencyCache, mutateCanvas, readCanvas, searchLayers, selectionContext, validateTransaction } from '../src/mcp/operations.ts'
import { paperTools, validateSchema } from '../src/mcp/schema.ts'
import type { ToolArguments } from '../src/mcp/operations.ts'

export interface WorkspaceOptions { workspace: string; file?: string }
interface LoadedFile { project: PaperProject; revision: string | null; legacy: boolean; mode: number }
const hash = (content: string): string => createHash('sha256').update(content).digest('hex')
const hasCode = (error: unknown, code: string): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === code

const fileReceipts = new IdempotencyCache()

/** A file-backed workspace, independent of the browser and of client sessions. */
export class PaperFiles {
  private readonly workspace: string
  private readonly defaultFile?: string

  private constructor(options: WorkspaceOptions) {
    this.workspace = options.workspace
    this.defaultFile = options.file
  }

  static async create(options: WorkspaceOptions): Promise<PaperFiles> {
    const workspace = await realpath(resolve(options.workspace))
    if (!(await stat(workspace)).isDirectory()) throw new Error('--workspace must be a directory')
    const files = new PaperFiles({ ...options, workspace })
    if (options.file) await files.path(options.file, true)
    return files
  }

  private contains(path: string): boolean {
    const local = relative(this.workspace, path)
    return local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)
  }

  /** Resolve both the parent and target to reject traversal and symlink escapes. */
  async path(input: unknown, project = false): Promise<string> {
    const name = input ?? this.defaultFile
    if (typeof name !== 'string' || !name.trim()) throw new Error('Supply file or configure --file with a Paper JSON path')
    if (name.includes('\0')) throw new Error('Invalid file path')
    const candidate = resolve(this.workspace, name)
    if (!this.contains(candidate)) throw new Error('File must be inside the configured workspace')
    if (project && extname(candidate).toLowerCase() !== '.json') throw new Error('Paper canvas files must use the .json extension (for example study.paper.json)')
    const parent = await realpath(dirname(candidate))
    if (!this.contains(parent)) throw new Error('File parent escapes the configured workspace')
    try {
      const actual = await realpath(candidate)
      if (!this.contains(actual)) throw new Error('File symlink escapes the configured workspace')
      if (!(await stat(actual)).isFile()) throw new Error('Path must be a regular file')
      return actual
    } catch (error) { if (!hasCode(error, 'ENOENT')) throw error }
    return join(parent, relative(dirname(candidate), candidate))
  }

  private async load(path: string, allowNew = false, name = 'Untitled'): Promise<LoadedFile> {
    try {
      const info = await stat(path)
      if (info.size > MAX_IMPORT_BYTES) throw new Error('Project files must be smaller than 16 MB')
      const source = await readFile(path, 'utf8')
      const project = parseProject(source)
      return { project, revision: hash(source), legacy: !Object.hasOwn(JSON.parse(source) as object, 'format'), mode: info.mode & 0o777 }
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error
      if (!allowNew) throw new Error('Paper file does not exist. Use create_frame to start a project.')
      return { project: createProject(new SceneStore(), name, { x: 0, y: 0, zoom: 1 }, true), revision: null, legacy: false, mode: 0o600 }
    }
  }

  /** Exclusive lock coordinates server processes; each mutation reloads disk. */
  private async edit<T>(path: string, work: () => Promise<T>): Promise<T> {
    const lockPath = `${path}.paper-mcp.lock`
    let lock
    try { lock = await open(lockPath, 'wx', 0o600) }
    catch (error) {
      if (hasCode(error, 'EEXIST')) throw new Error('This file is being edited by another Paper MCP process. Retry after it finishes; remove a stale .paper-mcp.lock only after that process has stopped.')
      throw error
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
      return await work()
    } finally { await lock.close(); await unlink(lockPath) }
  }

  private async save(path: string, source: string, before: LoadedFile): Promise<string> {
    if (Buffer.byteLength(source) > MAX_IMPORT_BYTES) throw new Error('The edited project would exceed the 16 MB file limit')
    let current: string | null = null
    try { current = hash(await readFile(path, 'utf8')) }
    catch (error) { if (!hasCode(error, 'ENOENT')) throw error }
    if (current !== before.revision) throw new Error('The file changed while editing. Read the latest canvas and retry.')
    if (before.revision !== null) await access(path, constants.W_OK)
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', before.mode)
    try {
      await handle.writeFile(source, 'utf8')
      await handle.sync()
      await handle.close()
      // Recheck after staging so slow writes cannot replace a newer external edit.
      let latest: string | null = null
      try { latest = hash(await readFile(path, 'utf8')) }
      catch (error) { if (!hasCode(error, 'ENOENT')) throw error }
      if (latest !== before.revision) throw new Error('The file changed while editing. Read the latest canvas and retry.')
      await rename(temporary, path)
    } finally {
      await handle.close().catch(() => {})
      await unlink(temporary).catch(error => { if (!hasCode(error, 'ENOENT')) throw error })
    }
    return hash(source)
  }

  async call(name: string, args: ToolArguments): Promise<Record<string, unknown>> {
    const path = await this.path(args.file, true)
    const displayPath = relative(this.workspace, path)
    if (name === 'get_basic_info' || name === 'list_tokens') {
      const loaded = await this.load(path)
      return { file: displayPath, projectId: displayPath, revision: loaded.revision, ...(name === 'get_basic_info' ? basicInfo(loaded.project) : { tokens: (loaded.project.scene.tokens ?? []).filter(token => !args.type || token.type === args.type) }) }
    }
    if (name === 'get_selection_context') {
      const loaded = await this.load(path)
      const ids = (args.element_ids as string[] | undefined) ?? []
      validateSchema(args, paperTools.find(tool => tool.name === name)!.inputSchema)
      return selectionContext(loaded.project, ids, { file: displayPath, projectId: displayPath, revision: loaded.revision! })
    }
    if (name === 'search_layers') {
      const loaded = await this.load(path)
      validateSchema(args, paperTools.find(tool => tool.name === name)!.inputSchema)
      return searchLayers(loaded.project, args, { file: displayPath, projectId: displayPath, revision: loaded.revision! })
    }
    if (name === 'get_canvas_elements') {
      const loaded = await this.load(path)
      return { file: displayPath, revision: loaded.revision, ...readCanvas(loaded.project, args.element_ids as string[] | undefined) }
    }
    if (name === 'export_selection') {
      const loaded = await this.load(path)
      const result = exportCanvas(loaded.project, args)
      let output: string | undefined
      if (args.output !== undefined) {
        const target = await this.path(args.output)
        if (target === path) throw new Error('Export output must be different from the source project')
        const extension = args.format === 'svg' ? '.svg' : '.json'
        if (extname(target).toLowerCase() !== extension) throw new Error(`Export output must use the ${extension} extension`)
        if (Buffer.byteLength(result.content) > MAX_IMPORT_BYTES) throw new Error('Export exceeds the 16 MB file limit')
        // Exclusive creation prevents accidental replacement of any existing file.
        const handle = await open(target, 'wx', 0o600)
        try { await handle.writeFile(result.content); await handle.sync() }
        catch (error) { await handle.close(); await unlink(target); throw error }
        finally { await handle.close().catch(() => {}) }
        output = relative(this.workspace, target)
      }
      return { file: displayPath, revision: loaded.revision, ...result, ...(output ? { output } : {}) }
    }
    if (name === 'apply_changes') {
      validateTransaction(args)
      const cached = fileReceipts.get(path, args)
      if (cached) return cached
      if (args.dry_run) {
        const loaded = await this.load(path)
        if (args.expected_revision !== loaded.revision) throw new Error('Revision mismatch. Read the latest canvas and retry.')
        const result = executeTransaction(loaded.project, args)
        return {
          file: displayPath,
          projectId: displayPath,
          revision: loaded.revision,
          dry_run: true,
          changedIds: result.changedIds,
          summary: result.summary,
          warnings: result.warnings,
          actionResults: result.actionResults,
        }
      }
      return this.edit(path, async () => {
        const cached = fileReceipts.get(path, args)
        if (cached) return cached
        const loaded = await this.load(path)
        if (args.expected_revision !== loaded.revision) throw new Error('Revision mismatch. Read the latest canvas and retry.')
        const result = executeTransaction(loaded.project, args)
        const source = loaded.legacy ? JSON.stringify(result.project.scene, null, 2) : serializeProject(result.project)
        parseProject(source)
        const revision = await this.save(path, source, loaded)
        const response = {
          file: displayPath,
          projectId: displayPath,
          revision,
          applied: true,
          changedIds: result.changedIds,
          summary: result.summary,
          warnings: result.warnings,
          actionResults: result.actionResults,
        }
        fileReceipts.set(path, args, response)
        return response
      })
    }
    return this.edit(path, async () => {
      const loaded = await this.load(path, name === 'create_frame', args.project_name as string | undefined)
      if (args.expected_revision !== undefined && args.expected_revision !== loaded.revision) throw new Error('Revision mismatch. Read the latest canvas and retry.')
      const result = mutateCanvas(loaded.project, name, args)
      const source = loaded.legacy ? JSON.stringify(result.project.scene, null, 2) : serializeProject(result.project)
      // Round-trip through the very same importer the browser uses before commit.
      parseProject(source)
      const revision = await this.save(path, source, loaded)
      return { file: displayPath, revision, ...(result.element ? { element: result.element } : { token: result.token }) }
    })
  }
}
