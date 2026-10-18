import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createProject } from '../src/io/project.ts'
import {
  extractFrameDesignContext,
  DesignContextError,
  formatDesignContextPromptSection,
} from '../src/make/design-context.ts'
import { formatPlanPrompt, formatGeneratePrompt, createAppPlan } from '../src/make/plan.ts'

function createTestSceneWithFrames() {
  const store = new SceneStore()

  // 1. Add design tokens
  store.addTokens([
    { id: 'tok_bg_card', name: 'card-background', type: 'color', value: '#111111' },
    { id: 'tok_text_pri', name: 'text-primary', type: 'color', value: '#edebe1' },
    { id: 'tok_accent', name: 'brand-accent', type: 'color', value: '#81adec' },
    { id: 'tok_radius_lg', name: 'radius-card', type: 'radius', value: 12 },
    { id: 'tok_gap_md', name: 'spacing-gap', type: 'spacing', value: 16 },
    { id: 'tok_unrelated_secret', name: 'unrelated-secret', type: 'color', value: '#ff0033' },
  ])

  // 2. Add target frame: nested card fixture
  let cardId = ''
  let headerId = ''
  let titleId = ''
  let avatarId = ''
  let actionsId = ''
  let saveBtnId = ''
  let saveTextId = ''

  store.batch(() => {
    // Root Card Frame
    const card = store.add('frame', {
      name: 'UserProfileCard',
      x: 100,
      y: 100,
      width: 480,
      height: 320,
      cornerRadius: 12,
      clipContent: true,
      layout: {
        direction: 'vertical',
        gap: 16,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        justify: 'start',
        align: 'start',
      },
    })
    cardId = card.id
    store.update(cardId, 'frame', { style: { fill: '#111111' } })
    store.bindToken(cardId, 'fill', 'tok_bg_card')
    store.bindToken(cardId, 'cornerRadius', 'tok_radius_lg')
    store.bindToken(cardId, 'x', 'tok_gap_md')

    // Header Child Frame
    const header = store.add('frame', {
      name: 'CardHeader',
      parentId: cardId,
      width: 432,
      height: 60,
      layout: {
        direction: 'horizontal',
        gap: 12,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        justify: 'start',
        align: 'center',
      },
    })
    headerId = header.id

    // Avatar inside Header
    const avatar = store.add('image', {
      name: 'UserAvatar',
      parentId: headerId,
      width: 48,
      height: 48,
      src: 'https://assets.paper.design/avatars/user_42.png',
      alt: 'Profile photo',
      cornerRadius: 24,
    })
    avatarId = avatar.id

    // Title inside Header
    const title = store.add('text', {
      name: 'ProfileTitle',
      parentId: headerId,
      width: 360,
      height: 28,
      text: 'Alex Rivera',
      fontSize: 20,
      fontWeight: 600,
    })
    titleId = title.id
    store.bindToken(titleId, 'fill', 'tok_text_pri')

    // Actions Frame
    const actions = store.add('frame', {
      name: 'ActionButtons',
      parentId: cardId,
      width: 432,
      height: 48,
      layout: {
        direction: 'horizontal',
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        justify: 'end',
        align: 'center',
      },
    })
    actionsId = actions.id

    // Save Button inside Actions
    const saveBtn = store.add('frame', {
      name: 'SaveButton',
      parentId: actionsId,
      width: 120,
      height: 40,
      cornerRadius: 6,
      layout: {
        direction: 'horizontal',
        gap: 4,
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
        justify: 'center',
        align: 'center',
      },
    })
    saveBtnId = saveBtn.id
    store.update(saveBtnId, 'frame', { style: { fill: '#81adec' } })
    store.bindToken(saveBtnId, 'fill', 'tok_accent')

    // Save Button Text
    const saveText = store.add('text', {
      name: 'SaveButtonText',
      parentId: saveBtnId,
      width: 80,
      height: 20,
      text: 'Save Changes',
      fontSize: 14,
      fontWeight: 500,
    })
    saveTextId = saveText.id
  })

  // 3. Add an UNRELATED root frame with private / separate content
  let unrelatedFrameId = ''
  let unrelatedTextId = ''
  store.batch(() => {
    const unrelated = store.add('frame', {
      name: 'InternalAdminConsole',
      x: 800,
      y: 100,
      width: 600,
      height: 500,
      layout: {
        direction: 'vertical',
        gap: 20,
        padding: { top: 32, right: 32, bottom: 32, left: 32 },
        justify: 'start',
        align: 'start',
      },
    })
    unrelatedFrameId = unrelated.id
    store.bindToken(unrelatedFrameId, 'fill', 'tok_unrelated_secret')

    const secretText = store.add('text', {
      name: 'SecretAdminKeys',
      parentId: unrelatedFrameId,
      width: 400,
      height: 40,
      text: 'Confidential Internal Admin Panel - API Keys: confidential-xyz',
    })
    unrelatedTextId = secretText.id
  })

  const project = createProject(store, 'Design System Project', { x: 0, y: 0, zoom: 1 }, true)

  return {
    project,
    scene: store.toJSON(),
    cardId,
    headerId,
    titleId,
    avatarId,
    actionsId,
    saveBtnId,
    saveTextId,
    unrelatedFrameId,
    unrelatedTextId,
  }
}

test('extractFrameDesignContext: extracts nested frame fixture with layout, elements, tokens, and assets', () => {
  const { project, cardId, headerId, titleId, avatarId, actionsId, saveBtnId, saveTextId } = createTestSceneWithFrames()

  const context = extractFrameDesignContext(project.scene, cardId, {
    projectId: 'proj_test_123',
    revision: 3,
  })

  assert.equal(context.frameId, cardId)
  assert.equal(context.frameName, 'UserProfileCard')
  assert.equal(context.bounds.width, 480)
  assert.equal(context.bounds.height, 320)
  assert.equal(context.cornerRadius, 12)
  assert.equal(context.layout?.direction, 'vertical')
  assert.equal(context.layout?.gap, 16)
  assert.equal(context.layout?.padding.top, 24)

  // Verify all nested elements are present
  const elementIds = context.elements.map(e => e.id)
  assert.ok(elementIds.includes(cardId), 'Root card frame must be in elements')
  assert.ok(elementIds.includes(headerId), 'Header frame must be in elements')
  assert.ok(elementIds.includes(titleId), 'Title text must be in elements')
  assert.ok(elementIds.includes(avatarId), 'Avatar image must be in elements')
  assert.ok(elementIds.includes(actionsId), 'Actions frame must be in elements')
  assert.ok(elementIds.includes(saveBtnId), 'Save button frame must be in elements')
  assert.ok(elementIds.includes(saveTextId), 'Save text must be in elements')
  assert.equal(context.elements.length, 7)

  // Verify layer IDs map matches the nested tree
  assert.deepEqual(
    [...context.layerIds].sort(),
    [cardId, headerId, titleId, avatarId, actionsId, saveBtnId, saveTextId].sort()
  )

  // Verify bound tokens are extracted and resolved
  const tokenNames = context.tokens.map(t => t.name)
  assert.ok(tokenNames.includes('card-background'))
  assert.ok(tokenNames.includes('text-primary'))
  assert.ok(tokenNames.includes('brand-accent'))
  assert.ok(tokenNames.includes('radius-card'))
  assert.ok(tokenNames.includes('spacing-gap'))

  // Verify assets are extracted
  assert.equal(context.assets.length, 1)
  assert.equal(context.assets[0].src, 'https://assets.paper.design/avatars/user_42.png')
  assert.equal(context.assets[0].alt, 'Profile photo')
})

test('extractFrameDesignContext: strictly isolates context; unrelated scene contents never enter model context', () => {
  const { project, cardId, unrelatedFrameId, unrelatedTextId } = createTestSceneWithFrames()

  const context = extractFrameDesignContext(project.scene, cardId)

  // Elements must NOT contain any unrelated IDs
  const elementIds = new Set(context.elements.map(e => e.id))
  assert.ok(!elementIds.has(unrelatedFrameId), 'Unrelated frame must NOT be in context')
  assert.ok(!elementIds.has(unrelatedTextId), 'Unrelated text must NOT be in context')

  // Layer IDs must NOT contain any unrelated IDs
  assert.ok(!context.layerIds.includes(unrelatedFrameId))
  assert.ok(!context.layerIds.includes(unrelatedTextId))

  // Tokens must NOT contain tokens used only by unrelated frame
  const tokenNames = context.tokens.map(t => t.name)
  assert.ok(!tokenNames.includes('unrelated-secret'), 'Unrelated tokens must NOT be in context')

  // Serialized context must NOT contain any mention of unrelated strings
  const serialized = JSON.stringify(context)
  assert.ok(!serialized.includes('InternalAdminConsole'))
  assert.ok(!serialized.includes('Confidential Internal Admin Panel'))
  assert.ok(!serialized.includes('confidential-xyz'))
  assert.ok(!serialized.includes('#ff0033'))
})

test('extractFrameDesignContext: rejects invalid or non-frame layer IDs', () => {
  const { project, titleId } = createTestSceneWithFrames()

  // Non-existent ID
  assert.throws(
    () => extractFrameDesignContext(project.scene, 'non_existent_frame_id'),
    DesignContextError
  )

  // Layer is text, not a frame
  assert.throws(
    () => extractFrameDesignContext(project.scene, titleId),
    (err) => {
      assert.ok(err instanceof DesignContextError)
      assert.match(err.message, /must be a frame/i)
      return true
    }
  )

  // Empty or invalid input
  assert.throws(
    () => extractFrameDesignContext(project.scene, ''),
    DesignContextError
  )
})

test('formatPlanPrompt: attaches bounded frame design context and instructs layer ID mapping', () => {
  const { project, cardId, saveBtnId, unrelatedFrameId } = createTestSceneWithFrames()
  const context = extractFrameDesignContext(project.scene, cardId)

  const { systemPrompt, userPrompt } = formatPlanPrompt('Build a user profile settings card', undefined, {
    designContext: context,
  })

  // Informs styling and layout
  assert.match(userPrompt, /UserProfileCard/i)
  assert.match(userPrompt, /480\s*x\s*320/i)
  assert.match(userPrompt, /vertical/i)
  assert.match(userPrompt, /16/i) // gap
  assert.match(userPrompt, /brand-accent/i)
  assert.match(userPrompt, /Alex Rivera/i)

  // Instructs stable layer IDs mapping
  assert.match(userPrompt, /data-layer-id/i)
  assert.match(userPrompt, new RegExp(cardId))
  assert.match(userPrompt, new RegExp(saveBtnId))

  // Unrelated contents must NEVER enter userPrompt or systemPrompt
  assert.ok(!userPrompt.includes(unrelatedFrameId))
  assert.ok(!userPrompt.includes('InternalAdminConsole'))
  assert.ok(!userPrompt.includes('Confidential Internal Admin Panel'))
  assert.ok(!userPrompt.includes('confidential-xyz'))
  assert.ok(!systemPrompt.includes('InternalAdminConsole'))
})

test('formatGeneratePrompt: attaches bounded frame design context and instructs layer ID mapping', () => {
  const { project, cardId, saveBtnId, unrelatedFrameId } = createTestSceneWithFrames()
  const context = extractFrameDesignContext(project.scene, cardId)

  const plan = createAppPlan({
    planId: 'plan_profile_01',
    prompt: 'Build profile card from frame',
    summary: 'Interactive profile card with save and avatar',
    files: [
      { path: 'src/App.tsx', description: 'Profile card with mapped layer IDs', action: 'modify' },
      { path: 'src/styles.css', description: 'Styles with frame tokens', action: 'modify' },
    ],
    interactions: ['Click Save button triggers save toast'],
    risks: ['Preserve exact 12px card corner radius and padding'],
  })

  const { systemPrompt, userPrompt } = formatGeneratePrompt(plan, undefined, {
    designContext: context,
  })

  // Mentions stable layer IDs to map into JSX
  assert.match(userPrompt, /data-layer-id/i)
  assert.match(userPrompt, new RegExp(cardId))
  assert.match(userPrompt, new RegExp(saveBtnId))
  assert.match(systemPrompt, /data-layer-id/i)

  // Mentions frame styling
  assert.match(userPrompt, /UserProfileCard/i)
  assert.match(userPrompt, /#81adec/i)

  // Unrelated contents must NOT enter prompt
  assert.ok(!userPrompt.includes(unrelatedFrameId))
  assert.ok(!userPrompt.includes('InternalAdminConsole'))
  assert.ok(!userPrompt.includes('confidential-xyz'))
})

test('nested selection contains no ancestor or component IDs and rejects oversized snapshots', () => {
  const { project, headerId, cardId } = createTestSceneWithFrames()
  const context = extractFrameDesignContext(project.scene, headerId)
  assert.equal(context.elements[0].parentId, null)
  assert.ok(!JSON.stringify(context).includes(cardId))
  assert.throws(() => extractFrameDesignContext(project.scene, headerId, { maxBytes: 100 }), DesignContextError)
})

test('workspace attaches only the selected reference and clears approval when attachment changes', async () => {
  const { createMakeWorkspaceStore } = await import('../src/make/workspace-model.ts')
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    return new Response(JSON.stringify({ plan: createAppPlan({ prompt: body.prompt, summary: 'Frame app',
      files: [{ path: 'src/App.tsx', description: 'Use frame' }], interactions: ['Click'] }) }), { headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const store = createMakeWorkspaceStore()
    const reference = { projectId: 'owned-design', frameId: 'nested-card', revision: 'hash-123' }
    store.setDesignReference(reference)
    await store.generatePlan('Build selected frame')
    assert.deepEqual(calls[0].sceneReference, reference)
    assert.ok(!Object.hasOwn(calls[0], 'designContext'))
    assert.ok(!JSON.stringify(calls[0]).includes('SECRET_UNRELATED_DATA'))
    await store.approveCurrentPlan()
    store.setDesignReference(null)
    assert.equal(store.getState().currentPlan, null)
    await store.generatePlan('Build without frame')
    assert.equal(calls[1].sceneReference, null)
  } finally { globalThis.fetch = originalFetch }
})
