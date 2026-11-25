import paper from 'paper'
import {
  applyStyle,
  clearShapeItems,
  createCircle,
  createPolygon,
  createRoundedRect,
  createStar,
  getDrawLayer,
  getScope,
  nextId,
} from './engine'
import type { ShapeItem, ShapeStyle } from './types'

const PLATE_STYLE: ShapeStyle = {
  fillColor: '#14142c',
  strokeColor: '#3c3c68',
  strokeWidth: 1,
  opacity: 1,
}

const MARK_STYLE: ShapeStyle = {
  fillColor: '#4a9eff',
  strokeColor: '#f7f8ff',
  strokeWidth: 8,
  opacity: 1,
  strokeJoin: 'round',
  shadowColor: 'rgba(74, 158, 255, 0.45)',
  shadowBlur: 28,
  shadowOffsetX: 0,
  shadowOffsetY: 10,
}

const ORB_STYLE: ShapeStyle = {
  fillColor: '#8b6cff',
  strokeColor: '#ffffff',
  strokeWidth: 0,
  opacity: 1,
}

const STAR_STYLE: ShapeStyle = {
  fillColor: '#ff4d8d',
  strokeColor: '#ffd0e2',
  strokeWidth: 0,
  opacity: 1,
}

const HEX_STYLE: ShapeStyle = {
  fillColor: null,
  strokeColor: '#5ce1ff',
  strokeWidth: 3,
  opacity: 1,
  strokeJoin: 'round',
}

const LABEL_STYLE: ShapeStyle = {
  fillColor: '#9aa0c8',
  strokeColor: '#9aa0c8',
  strokeWidth: 0,
  opacity: 1,
}

function register(
  item: paper.Item,
  name: string,
  style: ShapeStyle,
  extra?: Partial<ShapeItem>,
): ShapeItem {
  const id = nextId()
  item.data = { ...(item.data ?? {}), shapeId: id }
  return {
    id,
    name,
    paperItemId: item.id,
    style: { ...style },
    visible: true,
    locked: false,
    ...extra,
  }
}

function safeRemove(item: paper.Item | null | undefined) {
  try {
    item?.remove()
  } catch {
    // Boolean ops sometimes drop their inputs already.
  }
}

/** A rounded wedge joined to a circle, with a notch — the hero clip-path. */
function buildMark(center: paper.Point): paper.PathItem {
  const layer = getDrawLayer()
  layer.activate()

  const body = new paper.Path.Rectangle({
    from: center.add(new paper.Point(-128, -44)),
    to: center.add(new paper.Point(8, 44)),
    radius: 16,
    insert: true,
  })
  const cap = new paper.Path.Circle({
    center: center.add(new paper.Point(34, 0)),
    radius: 60,
    insert: true,
  })
  const notch = new paper.Path.Circle({
    center: center.add(new paper.Point(-108, 0)),
    radius: 24,
    insert: true,
  })

  try {
    const joined = body.unite(cap) as paper.PathItem
    safeRemove(body)
    safeRemove(cap)
    const cut = joined.subtract(notch) as paper.PathItem
    safeRemove(joined)
    safeRemove(notch)
    if (cut.bounds.width > 20 && cut.bounds.height > 20) return cut
    safeRemove(cut)
  } catch {
    safeRemove(body)
    safeRemove(cap)
    safeRemove(notch)
  }

  return new paper.Path.Circle({
    center,
    radius: 64,
    insert: true,
  })
}

/**
 * Replace the canvas with a small composition that shows primitives,
 * a boolean result, text, and something worth exporting as CSS.
 * Returns the shape metadata the store should adopt.
 */
export function loadSampleScene(): ShapeItem[] {
  const scope = getScope()
  scope.activate()
  clearShapeItems()
  const layer = getDrawLayer()
  layer.activate()

  // Keep the sample clear of the demo guide, which docks to the lower left.
  const origin = scope.view.center.add(new paper.Point(96, -36))
  const shapes: ShapeItem[] = []

  const plate = createRoundedRect(
    origin.add(new paper.Point(-250, -132)),
    origin.add(new paper.Point(250, 132)),
    28,
    PLATE_STYLE,
  )
  shapes.push(
    register(plate, 'Plate', PLATE_STYLE, {
      primitiveType: 'roundedRect',
      primitiveParams: { cornerRadius: 28 },
    }),
  )

  const mark = buildMark(origin.add(new paper.Point(-16, 0)))
  applyStyle(mark, MARK_STYLE)
  shapes.push(register(mark, 'Mark', MARK_STYLE))

  const orb = createCircle(origin.add(new paper.Point(-168, -52)), 34, ORB_STYLE)
  shapes.push(
    register(orb, 'Orb', ORB_STYLE, {
      primitiveType: 'circle',
    }),
  )

  const star = createStar(origin.add(new paper.Point(158, -46)), 5, 22, 52, STAR_STYLE)
  shapes.push(
    register(star, 'Star', STAR_STYLE, {
      primitiveType: 'star',
      primitiveParams: { points: 5, innerRadius: 22, outerRadius: 52 },
    }),
  )

  const hex = createPolygon(origin.add(new paper.Point(148, 62)), 6, 36, HEX_STYLE)
  shapes.push(
    register(hex, 'Hexagon', HEX_STYLE, {
      primitiveType: 'polygon',
      primitiveParams: { sides: 6 },
    }),
  )

  const labelPoint = origin.add(new paper.Point(-34, 112))
  const label = new paper.PointText({
    point: labelPoint,
    content: 'clip-path',
    fillColor: new paper.Color('#c6cbe8'),
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: 16,
    fontWeight: '600',
    insert: true,
  })
  shapes.push(
    register(label, 'Label', { ...LABEL_STYLE, fillColor: '#c6cbe8' }, {
      textContent: 'clip-path',
      fontSize: 16,
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    }),
  )

  scope.view.update()
  return shapes
}
