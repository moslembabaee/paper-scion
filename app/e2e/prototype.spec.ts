import { mockStudioSession } from './studio-session'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SceneStore } from '../src/scene/store'
import { createProject } from '../src/io/project'
import { DEFAULT_TRANSITION } from '../src/prototype/model'
import { SPRING_PRESETS, springDuration } from '../src/prototype/spring'
import type { InteractionTrigger, PrototypeInteraction, TransitionKind } from '../src/prototype/types'
import { drag, waitForCanvasReady } from './helpers'

function fixture(trigger: InteractionTrigger = 'click', kind: TransitionKind = 'dissolve', horizontal = false) {
  const store = new SceneStore()
  store.add('frame', { id: 'a', name: 'Welcome', width: 390, height: 420 })
  store.add('frame', { id: 'b', name: 'Details', x: 510, width: 390, height: 420, style: { fill: '#81adec' } })
  store.add('frame', { id: 'c', name: 'First overlay', x: 1020, width: 270, height: 180 })
  store.add('frame', { id: 'd', name: 'Second overlay', x: 1400, width: 240, height: 160 })
  for (const [parentId, y] of [['a', 80], ['b', 180], ['c', 50], ['d', 40]] as const) {
    store.add('rectangle', { id: `${parentId}-button`, parentId, name: 'Continue', x: 40, y, width: 170, height: 60, rotation: parentId === 'b' ? 12 : 0, style: { fill: '#080808', opacity: parentId === 'b' ? .7 : 1 } })
  }
  store.add('rectangle', { id: 'scroll-button', parentId: 'a', name: 'Scroll down', x: 40, y: 230, width: 170, height: 50 })
  store.add('rectangle', { id: 'bottom', parentId: 'a', name: 'Bottom section', x: horizontal ? 900 : 20, y: horizontal ? 40 : 900, width: 350, height: 300, style: { fill: '#81adec' } })
  const interaction = (id: string, sourceId: string, targetId: string, action: PrototypeInteraction['action'] = 'navigate'): PrototypeInteraction => ({ id, sourceId, targetId, action, trigger: 'click', delay: 800, transition: { ...DEFAULT_TRANSITION, kind, duration: 160 } })
  store.setPrototype({ startFrameId: 'a', device: 'none', interactions: [
    { ...interaction('main', 'a-button', 'b'), trigger, delay: 800 },
    interaction('overlay-one', 'b-button', 'c', 'overlay'),
    interaction('overlay-two', 'c-button', 'd', 'overlay'),
    interaction('scroll', 'scroll-button', 'bottom', 'scroll'),
  ] })
  return createProject(store, 'Interactive study', { x: 60, y: 100, zoom: .6 }, true)
}

async function open(page: Page, trigger: InteractionTrigger = 'click', kind: TransitionKind = 'dissolve', horizontal = false) {
  await page.addInitScript(project => localStorage.setItem('paper.project.v1', JSON.stringify(project)), fixture(trigger, kind, horizontal))
  await mockStudioSession(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Present prototype', exact: true }).click()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'a')
  return page.getByRole('dialog', { name: 'Welcome', exact: true })
}

test('dragging a wire authors a persistent, undoable interaction and exposes transition controls', async ({ page }) => {
  await waitForCanvasReady(page)
  await page.getByTestId('prototype-mode-toggle').click()
  const source = page.locator('[data-element-id="space"]'), target = page.locator('[data-element-id="room"]')
  await source.click({ position: { x: 10, y: 10 } })
  const handle = await page.getByTestId('prototype-connect-handle').boundingBox(), box = await target.boundingBox()
  expect(handle).not.toBeNull(); expect(box).not.toBeNull()
  await drag(page, { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 }, { x: box!.x + 10, y: box!.y + 10 })
  await expect(page.locator('.prototype-wire')).toHaveCount(1)
  await page.getByLabel('Interaction trigger', { exact: true }).selectOption('delay')
  await page.getByLabel('Delay milliseconds').fill('1400')
  await page.getByLabel('Transition animation').selectOption('smart')
  await page.getByLabel('Transition easing').selectOption('custom')
  await page.getByLabel('Bezier x1').fill('0.25')
  await page.getByLabel('Starting frame').selectOption('space')
  await page.getByLabel('Presentation device').selectOption('phone')
  await expect(page.getByRole('img', { name: /Easing curve/ })).toBeVisible()
  await page.getByRole('button', { name: 'Remove interaction', exact: true }).click()
  await expect(page.locator('.prototype-wire')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.prototype-wire')).toHaveCount(1)
  await expect(page.getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible()
  await page.reload()
  await page.getByTestId('prototype-mode-toggle').click()
  await expect(page.locator('.prototype-wire')).toHaveCount(1)
  await expect(page.getByLabel('Presentation device')).toHaveValue('phone')
})

test('spring authoring previews motion, persists physics and restores previous settings with undo', async ({ page }) => {
  await page.addInitScript(project => localStorage.setItem('paper.project.v1', JSON.stringify(project)), fixture())
  await mockStudioSession(page)
  await page.goto('/')
  await page.getByTestId('prototype-mode-toggle').click()
  await page.locator('.viewport-world [data-element-id="a-button"]').click()
  await page.getByLabel('Transition animation').selectOption('smart')
  await page.getByLabel('Transition easing').selectOption('spring')
  await page.getByLabel('Spring preset').selectOption('bouncy')
  await page.getByLabel('Spring stiffness').fill('220')
  await expect(page.getByLabel('Spring preset')).toHaveValue('custom')
  await expect(page.getByRole('img', { name: 'Spring response curve' })).toBeVisible()
  await expect(page.getByLabel('Duration milliseconds')).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview spring', exact: true }).click()
  await expect.poll(() => page.locator('.prototype-spring-track > span').evaluate(node => node.getAnimations().length)).toBe(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByLabel('Spring stiffness')).toHaveValue('180')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.getByLabel('Spring stiffness')).toHaveValue('220')
  await expect(page.getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible()
  await page.reload()
  await page.getByTestId('prototype-mode-toggle').click()
  await page.locator('.viewport-world [data-element-id="a-button"]').click()
  await expect(page.getByLabel('Transition easing')).toHaveValue('spring')
  await expect(page.getByLabel('Spring stiffness')).toHaveValue('220')
  await expect(page.getByLabel('Spring damping')).toHaveValue('12')
  await expect(page.getByLabel('Spring mass')).toHaveValue('1')
})

for (const kind of ['smart', 'slide-in', 'slide-out', 'push', 'slide'] as const) {
  test(`spring ${kind} renders native motion and cleans up at rest`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const project = fixture('click', kind)
    const prototype = project.scene.prototype!
    const springProject = { ...project, scene: { ...project.scene, prototype: { ...prototype, interactions: prototype.interactions.map(item => ({ ...item, transition: { ...item.transition, easing: 'spring', spring: SPRING_PRESETS.bouncy.spring } })) } } }
    await page.addInitScript(value => localStorage.setItem('paper.project.v1', JSON.stringify(value)), springProject)
    await mockStudioSession(page)
  await page.goto('/')
    await page.getByRole('button', { name: 'Present prototype', exact: true }).click()
    const player = page.locator('.prototype-player')
    await player.locator('[data-element-id="a-button"]').click()
    await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b')
    const result = await player.evaluate((node, kind) => {
      const animations = node.getAnimations({ subtree: true })
      for (const animation of animations) { animation.pause(); animation.currentTime = 250 }
      const subject = kind === 'smart' ? node.querySelector('[data-element-id="b-button"]')! : node.querySelectorAll('.prototype-layer')[kind === 'slide-out' ? 0 : 1]
      const transform = getComputedStyle(subject).transform
      return { count: animations.length, durations: animations.map(animation => animation.effect!.getTiming().duration), easings: animations.map(animation => animation.effect!.getTiming().easing), x: new DOMMatrixReadOnly(transform).m41, transform }
    }, kind)
    expect(result.count).toBeGreaterThan(0)
    expect(result.durations.every(duration => duration === springDuration(SPRING_PRESETS.bouncy.spring))).toBe(true)
    expect(result.easings.every(easing => easing?.startsWith('linear('))).toBe(true)
    if (kind === 'slide-in' || kind === 'slide') expect(result.x).toBeLessThan(-30)
    if (kind === 'slide-out') expect(result.x).toBeLessThan(-420)
    if (kind === 'push') expect(result.x).toBeLessThan(-30)
    if (kind === 'smart') expect(result.transform).not.toBe('none')
    await player.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => animation.finish()))
    await expect(player.locator('.prototype-layer')).toHaveCount(1)
    await expect.poll(() => player.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0)
    await player.getByRole('button', { name: 'Restart prototype' }).click()
    await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'a')
    expect(errors).toEqual([])
  })
}

test('spring preview respects reduced motion and mobile presentation fits its viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const project = fixture('click', 'smart'), prototype = project.scene.prototype!
  await page.addInitScript(value => localStorage.setItem('paper.project.v1', JSON.stringify(value)), { ...project, scene: { ...project.scene, prototype: { ...prototype, interactions: prototype.interactions.map(item => ({ ...item, transition: { ...item.transition, easing: 'spring', spring: SPRING_PRESETS.bouncy.spring } })) } } })
  await mockStudioSession(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Present prototype', exact: true }).click()
  await page.locator('.prototype-player [data-element-id="a-button"]').click()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b')
  await expect(page.locator('.prototype-player .prototype-layer')).toHaveCount(1)
  await expect.poll(() => page.locator('.prototype-player').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  const box = await page.locator('.prototype-player').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  await expect(page.getByRole('button', { name: 'Restart prototype' })).toBeVisible()
})

for (const kind of ['instant', 'dissolve', 'smart', 'slide-in', 'slide-out', 'push', 'slide'] as const) {
  test(`click navigation plays ${kind} and preserves the design`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await open(page, 'click', kind)
    const player = page.locator('.prototype-player')
    await player.locator('[data-element-id="a-button"]').click()
    await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b')
    await expect(player.locator('.prototype-layer')).toHaveCount(1)
    await expect(player.locator('[data-element-id="b-button"]')).toHaveCSS('transform-origin', '85px 30px')
    await player.getByRole('button', { name: 'Go back', exact: true }).click()
    await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'a')
    await page.keyboard.press('Escape')
    await expect(player).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Present prototype', exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    expect(errors).toEqual([])
  })
}

test('hover and drag triggers execute on the interaction source', async ({ page }) => {
  await open(page, 'hover')
  await page.locator('.prototype-player [data-element-id="a-button"]').hover()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b')
  await page.keyboard.press('Escape')
  // Change the trigger through the actual editor before playing it again.
  await page.getByTestId('prototype-mode-toggle').click()
  await page.locator('.viewport-world [data-element-id="a-button"]').click()
  await page.getByLabel('Interaction trigger', { exact: true }).selectOption('drag')
  await page.getByRole('button', { name: 'Present prototype', exact: true }).click()
  const box = await page.locator('.prototype-player [data-element-id="a-button"]').boundingBox()
  await page.mouse.move(box!.x + 20, box!.y + 20)
  await page.mouse.down()
  await page.mouse.move(box!.x + 70, box!.y + 20, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b')
})

test('delay waits while paused and resumes; keyboard hotspots and mockups are interactive', async ({ page }) => {
  test.setTimeout(60000)
  await open(page, 'delay')
  await page.getByRole('button', { name: 'Pause prototype', exact: true }).click()
  await page.waitForTimeout(950)
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'a')
  await page.getByRole('button', { name: 'Resume prototype', exact: true }).click()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b')
  await expect(page.locator('.prototype-player .prototype-layer')).toHaveCount(1)
  const source = page.locator('.prototype-player [data-element-id="b-button"]')
  await source.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-overlay-id', 'c')
  await page.keyboard.press('Escape')
  await page.getByTestId('prototype-mode-toggle').click()
  for (const device of ['phone', 'tablet', 'desktop', 'none']) {
    await page.getByLabel('Presentation device').selectOption(device)
    await page.getByRole('button', { name: 'Present prototype', exact: true }).click()
    await expect(page.locator(`.prototype-device.device-${device}`)).toBeVisible()
    await page.getByRole('button', { name: 'Show interaction hotspots' }).click()
    await expect(page.getByTestId('prototype-display')).toHaveClass(/show-hotspots/)
    await page.keyboard.press('Escape')
  }
})

test('overlay history returns to the previous overlay and the base screen', async ({ page }) => {
  await open(page)
  const player = page.locator('.prototype-player'), display = page.getByTestId('prototype-display')
  await player.locator('[data-element-id="a-button"]').click()
  await expect(player.locator('.prototype-layer')).toHaveCount(1)
  await player.locator('[data-element-id="b-button"]').click()
  await expect(display).toHaveAttribute('data-overlay-id', 'c')
  await player.locator('[data-element-id="c-button"]').click()
  await expect(display).toHaveAttribute('data-overlay-id', 'd')
  await player.getByRole('button', { name: 'Go back', exact: true }).click()
  await expect(display).toHaveAttribute('data-overlay-id', 'c')
  await player.getByRole('button', { name: 'Go back', exact: true }).click()
  await expect(display).toHaveAttribute('data-overlay-id', '')
  await expect(display).toHaveAttribute('data-frame-id', 'b')
  await player.getByRole('button', { name: 'Go back', exact: true }).click()
  await expect(display).toHaveAttribute('data-frame-id', 'a')
})

test('scroll-to reveals content beyond a clipped frame and restart resets scroll', async ({ page }) => {
  await open(page)
  const player = page.locator('.prototype-player'), scroller = player.locator('.prototype-screen-scroll')
  await player.locator('[data-element-id="scroll-button"]').click()
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(700)
  const target = await player.locator('[data-element-id="bottom"]').boundingBox()
  const display = await page.getByTestId('prototype-display').boundingBox()
  expect(target!.y).toBeLessThan(display!.y + display!.height)
  expect(await player.locator('[data-element-id="a"] > .scene-content').evaluate(node => getComputedStyle(node).overflow)).toBe('visible')
  await player.getByRole('button', { name: 'Restart prototype' }).click()
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(0)
})

test('reduced motion completes navigation without a running transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, 'click', 'smart')
  await page.locator('.prototype-player [data-element-id="a-button"]').click()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b')
  await expect(page.locator('.prototype-player .prototype-layer')).toHaveCount(1)
  expect(await page.locator('.prototype-player').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0)
})

test('horizontal scroll-to reveals wide content and restart resets both axes', async ({ page }) => {
  await open(page, 'click', 'dissolve', true)
  const player = page.locator('.prototype-player'), scroller = player.locator('.prototype-screen-scroll')
  await player.locator('[data-element-id="scroll-button"]').click()
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(700)
  const target = await player.locator('[data-element-id="bottom"]').boundingBox()
  const display = await page.getByTestId('prototype-display').boundingBox()
  expect(target!.x).toBeLessThan(display!.x + display!.width)
  await player.getByRole('button', { name: 'Restart prototype' }).click()
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBe(0)
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(0)
})

test('prototype inspector remains available on a narrow editor viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await waitForCanvasReady(page)
  await page.getByTestId('prototype-mode-toggle').click()
  await expect(page.getByTestId('prototype-inspector')).toBeVisible()
  await page.getByLabel('Presentation device').selectOption('tablet')
  await page.getByRole('button', { name: 'Present prototype', exact: true }).click()
  await expect(page.locator('.prototype-device.device-tablet')).toBeVisible()
})

test('resuming an After Delay interaction preserves its remaining countdown', async ({ page }) => {
  const project = fixture('delay')
  const prototype = project.scene.prototype!
  const delayedProject = { ...project, scene: { ...project.scene, prototype: { ...prototype, interactions: prototype.interactions.map(item => item.id === 'main' ? { ...item, delay: 2400 } : item) } } }
  await page.addInitScript(value => localStorage.setItem('paper.project.v1', JSON.stringify(value)), delayedProject)
  await mockStudioSession(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Present prototype', exact: true }).click()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'a')
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause prototype', exact: true }).click()
  await page.waitForTimeout(1200)
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'a')
  await page.getByRole('button', { name: 'Resume prototype', exact: true }).click()
  await expect(page.getByTestId('prototype-display')).toHaveAttribute('data-frame-id', 'b', { timeout: 1800 })
})
