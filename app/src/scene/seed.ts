import { SceneStore } from './store.ts'
import { createShader } from '../shaders/catalog.ts'

/** The opening studies are ordinary editable elements, rather than special HTML. */
export function createDemoScene(): SceneStore {
  const store = new SceneStore()
  store.batch(() => {
    const hero = store.add('frame', { id: 'space', name: '01 — A little space', width: 720, height: 480 })
    const poster = store.add('frame', { id: 'room', name: '02 — Make room', x: 840, width: 360, height: 480, style: { fill: '#81adec' } })
    const material = store.add('frame', { id: 'material', name: '03 — Material studies', y: 600, width: 720, height: 240, style: { fill: '#222222' } })
    const text = (parentId: string, name: string, content: string, x: number, y: number, width: number, height: number, size: number, fill = '#080808', spacing = 0, weight = 400) => store.add('text', { parentId, name, text: content, x, y, width, height, fontSize: size, fontWeight: weight, letterSpacing: spacing, style: { fill } })
    const arrow = (parentId: string, x: number, y: number, down = false) => store.add('path', { parentId, name: down ? 'Arrow down' : 'Arrow up', x, y, width: 16, height: 16, viewBox: [0, 0, 16, 16], d: down ? 'M 3 3 L 13 13 M 3 13 H 13 V 3' : 'M 3 13 L 13 3 M 3 3 H 13 V 13', style: { fill: null, stroke: { color: '#080808', width: 1.25, dash: [] } } })
    text(hero.id, 'Studio label', 'SPACE / STUDIO', 42, 34, 200, 16, 10, '#080808', .3)
    text(hero.id, 'Independent by nature', 'Independent by nature', 535, 34, 130, 16, 10, '#77766f')
    arrow(hero.id, 664, 33)
    text(hero.id, 'A little space', 'A little space.\nA lot of possibility.', 42, 119, 638, 132, 57, '#080808', -3.5, 500)
    text(hero.id, 'Introduction', 'A place for ideas to take shape.\nMade for the way you think.', 42, 279, 460, 55, 14, '#77766f')
    text(hero.id, 'Make something your own', 'Make something your own', 42, 420, 190, 19, 11)
    arrow(hero.id, 233, 418)
    store.add('rectangle', { parentId: hero.id, name: 'CTA underline', x: 42, y: 444, width: 207, height: 1, style: { fill: '#77766f' } })
    text(hero.id, 'Established', 'EST. 2026', 624, 428, 70, 14, 9, '#77766f')
    text(hero.id, 'Blue cross', '+', 652, 345, 32, 48, 36, '#81adec', 0, 200)

    text(poster.id, 'Study label', 'STUDY / 002', 28, 28, 220, 16, 9, '#080808', .7)
    arrow(poster.id, 316, 28, true)
    const orbit = store.add('frame', { parentId: poster.id, name: 'Orbital study', x: 40, y: 73, width: 280, height: 280, clipContent: false, style: { fill: null } })
    const orbitStyle = { fill: null, stroke: { color: '#080808', width: 1, dash: [] } }
    store.add('ellipse', { parentId: orbit.id, name: 'Outer orbit', x: 24, y: 24, width: 232, height: 232, style: orbitStyle })
    store.add('ellipse', { parentId: orbit.id, name: 'Diagonal orbit / 01', x: 24, y: 100, width: 232, height: 80, rotation: -45, style: orbitStyle })
    store.add('ellipse', { parentId: orbit.id, name: 'Diagonal orbit / 02', x: 24, y: 100, width: 232, height: 80, rotation: 45, style: orbitStyle })
    store.add('ellipse', { parentId: orbit.id, name: 'Vertical orbit', x: 100, y: 24, width: 80, height: 232, style: orbitStyle })
    store.add('path', { parentId: orbit.id, name: 'Construction axes', width: 280, height: 280, viewBox: [0, 0, 280, 280], d: 'M 0 140 H 280 M 140 0 V 280', style: { fill: null, opacity: .25, stroke: { color: '#080808', width: 1, dash: [3, 4] } } })
    store.add('ellipse', { parentId: orbit.id, name: 'Satellite', x: 215, y: 51, width: 16, height: 16, style: { fill: '#080808' } })
    store.add('ellipse', { parentId: orbit.id, name: 'Center', x: 134, y: 134, width: 12, height: 12, style: { fill: '#edebe1', stroke: { color: '#080808', width: 1, dash: [] } } })
    text(poster.id, 'Make room', 'Make room.', 28, 383, 310, 56, 42, '#080808', -2, 500)
    text(poster.id, 'For something new', 'FOR SOMETHING NEW', 28, 438, 310, 14, 9, '#080808', .8)

    text(material.id, 'Material label', 'MATERIAL / 003', 40, 30, 290, 12, 8, '#a6a59e', .6)
    text(material.id, 'Simple things', 'Simple things.\nConsidered well.', 40, 66, 380, 82, 32, '#edebe1', -1)
    text(material.id, 'Material caption', 'FORM, COLOUR & A LITTLE CURIOSITY.', 40, 174, 300, 14, 8, '#a6a59e', .6)
    store.add('ellipse', { parentId: material.id, name: 'Outline circle', x: 440, y: 64, width: 112, height: 112, style: { fill: null, stroke: { color: '#edebe1', width: 1, dash: [] } } })
    store.add('ellipse', { parentId: material.id, name: 'Mesh Gradient study', x: 504, y: 64, width: 112, height: 112, style: { shader: createShader('mesh-gradient') } })
    store.add('rectangle', { parentId: material.id, name: 'Cream square', x: 568, y: 64, width: 112, height: 112, style: { fill: '#edebe1' } })
  })
  store.clearHistory()
  return store
}
