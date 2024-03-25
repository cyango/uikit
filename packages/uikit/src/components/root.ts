import { Signal, computed, signal } from '@preact/signals-core'
import { Object3DRef, RootContext, WithContext } from '../context'
import { FlexNode, YogaProperties } from '../flex'
import { LayoutListeners, Listeners, ScrollListeners, setupLayoutListeners } from '../listeners'
import { PanelProperties, createInstancedPanel } from '../panel/instanced-panel'
import { PanelGroupManager, ShadowProperties, computePanelGroupDependencies } from '../panel/instanced-panel-group'
import { MaterialClass } from '../panel/panel-material'
import { WithAllAliases } from '../properties/alias'
import { AllOptionalProperties, Properties, WithClasses, WithReactive } from '../properties/default'
import { MergedProperties, PropertyTransformers } from '../properties/merged'
import {
  ScrollbarProperties,
  applyScrollPosition,
  computeGlobalScrollMatrix,
  createScrollPosition,
  createScrollbars,
  setupScrollHandler,
} from '../scroll'
import { TransformProperties, applyTransform, computeTransformMatrix } from '../transform'
import { Subscriptions, alignmentXMap, alignmentYMap, loadYoga, readReactive, unsubscribeSubscriptions } from '../utils'
import { WithConditionals } from './utils'
import { computeClippingRect } from '../clipping'
import { computeOrderInfo, ElementType, WithCameraDistance } from '../order'
import { Camera, Matrix4, Plane, Vector2Tuple, Vector3 } from 'three'
import { GlyphGroupManager } from '../text/render/instanced-glyph-group'
import { createGetBatchedProperties } from '../properties/batched'
import { addActiveHandlers, createActivePropertyTransfomers } from '../active'
import { preferredColorSchemePropertyTransformers } from '../dark'
import { addHoverHandlers, createHoverPropertyTransformers, setupCursorCleanup } from '../hover'
import { cloneHandlers, createInteractionPanel } from '../panel/instanced-panel-mesh'
import { createResponsivePropertyTransformers } from '../responsive'
import { EventHandlers } from '../events'

export type InheritableRootProperties = WithConditionals<
  WithClasses<
    WithAllAliases<
      WithReactive<
        Omit<YogaProperties, 'width' | 'height'> &
          TransformProperties &
          PanelProperties &
          ScrollbarProperties &
          ShadowProperties & {
            panelMaterialClass?: MaterialClass
            sizeX?: number
            sizeY?: number
            anchorX?: keyof typeof alignmentXMap
            anchorY?: keyof typeof alignmentYMap
          }
      >
    >
  >
>

export type RootProperties = InheritableRootProperties & {
  pixelSize?: number
} & EventHandlers &
  LayoutListeners &
  ScrollListeners

const DEFAULT_PIXEL_SIZE = 0.002

const vectorHelper = new Vector3()
const planeHelper = new Plane()

const notClipped = signal(false)

export function createRoot(
  properties: RootProperties,
  defaultProperties: AllOptionalProperties | undefined,
  object: Object3DRef,
  childrenContainer: Object3DRef,
  getCamera: () => Camera,
) {
  const rootSize = signal<Vector2Tuple>([0, 0])
  const hoveredSignal = signal<Array<number>>([])
  const activeSignal = signal<Array<number>>([])
  const subscriptions = [] as Subscriptions
  setupCursorCleanup(hoveredSignal, subscriptions)
  const pixelSize = properties.pixelSize ?? DEFAULT_PIXEL_SIZE

  const transformers: PropertyTransformers = {
    ...createSizeTranslator(pixelSize, 'sizeX', 'width'),
    ...createSizeTranslator(pixelSize, 'sizeY', 'height'),
    ...preferredColorSchemePropertyTransformers,
    ...createResponsivePropertyTransformers(rootSize),
    ...createHoverPropertyTransformers(hoveredSignal),
    ...createActivePropertyTransfomers(activeSignal),
  }

  const scrollHandlers = signal<EventHandlers>({})
  const propertiesSignal = signal(properties)
  const defaultPropertiesSignal = signal(defaultProperties)
  const onFrameSet = new Set<(delta: number) => void>()

  const mergedProperties = computed(() => {
    const merged = new MergedProperties(transformers)
    merged.addAll(defaultProperties, properties)
    return merged
  })

  const requestCalculateLayout = createDeferredRequestLayoutCalculation(onFrameSet, subscriptions)
  const node = new FlexNode(
    mergedProperties,
    rootSize,
    object,
    loadYoga(),
    0.01,
    requestCalculateLayout,
    undefined,
    subscriptions,
  )
  subscriptions.push(() => node.destroy())

  const transformMatrix = computeTransformMatrix(mergedProperties, node, pixelSize)
  const rootMatrix = computeRootMatrix(mergedProperties, transformMatrix, node.size, pixelSize)

  applyTransform(object, transformMatrix, subscriptions)
  const groupDeps = computePanelGroupDependencies(mergedProperties)

  const orderInfo = computeOrderInfo(mergedProperties, ElementType.Panel, groupDeps, undefined)

  const ctx: WithCameraDistance = { cameraDistance: 0 }

  const panelGroupManager = new PanelGroupManager(pixelSize, ctx, object)
  onFrameSet.add(panelGroupManager.onFrame)
  subscriptions.push(() => onFrameSet.delete(panelGroupManager.onFrame))

  const onCameraDistanceFrame = () => {
    if (object.current == null) {
      ctx.cameraDistance = 0
      return
    }
    planeHelper.normal.set(0, 0, 1)
    planeHelper.constant = 0
    planeHelper.applyMatrix4(object.current.matrixWorld)
    vectorHelper.setFromMatrixPosition(getCamera().matrixWorld)
    ctx.cameraDistance = planeHelper.distanceToPoint(vectorHelper)
  }
  onFrameSet.add(onCameraDistanceFrame)
  subscriptions.push(() => onFrameSet.delete(onCameraDistanceFrame))

  createInstancedPanel(
    mergedProperties,
    orderInfo,
    groupDeps,
    panelGroupManager,
    rootMatrix,
    node.size,
    undefined,
    node.borderInset,
    undefined,
    undefined,
    subscriptions,
  )

  const scrollPosition = createScrollPosition()
  applyScrollPosition(childrenContainer, scrollPosition, pixelSize)
  const matrix = computeGlobalScrollMatrix(scrollPosition, rootMatrix, pixelSize)
  createScrollbars(
    mergedProperties,
    scrollPosition,
    node,
    rootMatrix,
    undefined,
    undefined,
    orderInfo,
    panelGroupManager,
    subscriptions,
  )

  const clippingRect = computeClippingRect(rootMatrix, node.size, node.borderInset, node.overflow, pixelSize, undefined)

  setupLayoutListeners(propertiesSignal, node.size, subscriptions)

  const onScrollFrame = setupScrollHandler(
    node,
    scrollPosition,
    object,
    propertiesSignal,
    pixelSize,
    scrollHandlers,
    subscriptions,
  )
  onFrameSet.add(onScrollFrame)
  subscriptions.push(() => onFrameSet.delete(onScrollFrame))
  const gylphGroupManager = new GlyphGroupManager(pixelSize, ctx, object)
  onFrameSet.add(gylphGroupManager.onFrame)
  subscriptions.push(() => onFrameSet.delete(gylphGroupManager.onFrame))

  const rootCtx: RootContext = Object.assign(ctx, {
    isClipped: notClipped,
    onFrameSet,
    cameraDistance: 0,
    clippingRect,
    gylphGroupManager,
    matrix,
    node,
    object,
    orderInfo,
    panelGroupManager,
    pixelSize,
  })

  return Object.assign(rootCtx, {
    subscriptions,
    propertiesSignal,
    defaultPropertiesSignal,
    scrollHandlers,
    interactionPanel: createInteractionPanel(node, orderInfo, rootCtx, undefined, subscriptions),
    handlers: computed(() => {
      const handlers = cloneHandlers(properties)
      addHoverHandlers(handlers, properties, defaultProperties, hoveredSignal)
      addActiveHandlers(handlers, properties, defaultProperties, activeSignal)
      return handlers
    }),
    root: rootCtx,
  })
}

export function destroyRoot(internals: ReturnType<typeof createRoot>) {
  unsubscribeSubscriptions(internals.subscriptions)
}

function createDeferredRequestLayoutCalculation(
  onFrameSet: Set<(delta: number) => void>,
  subscriptions: Subscriptions,
) {
  let requestedNode: FlexNode | undefined
  const onFrame = () => {
    if (requestedNode == null) {
      return
    }
    const node = requestedNode
    requestedNode = undefined
    node.calculateLayout()
  }
  onFrameSet.add(onFrame)
  subscriptions.push(() => onFrameSet.delete(onFrame))
  return (node: FlexNode) => {
    if (requestedNode != null || node['yogaNode'] == null) {
      return
    }
    requestedNode = node
  }
}

function createSizeTranslator(pixelSize: number, key: 'sizeX' | 'sizeY', to: string): PropertyTransformers {
  const map = new Map<unknown, Signal<number | undefined>>()
  return {
    [key]: (value: unknown, target: MergedProperties) => {
      let entry = map.get(value)
      if (entry == null) {
        map.set(
          value,
          (entry = computed(() => {
            const s = readReactive(value) as number | undefined
            if (s == null) {
              return undefined
            }
            return s / pixelSize
          })),
        )
      }
      target.add(to, entry)
    },
  }
}
const matrixHelper = new Matrix4()

const keys = ['anchorX', 'anchorY']

function computeRootMatrix(
  propertiesSignal: Signal<MergedProperties>,
  matrix: Signal<Matrix4 | undefined>,
  size: Signal<Vector2Tuple>,
  pixelSize: number,
) {
  const get = createGetBatchedProperties(propertiesSignal, keys)
  return computed(() => {
    const [width, height] = size.value
    return matrix.value
      ?.clone()
      .premultiply(
        matrixHelper.makeTranslation(
          alignmentXMap[(get('anchorX') as keyof typeof alignmentXMap) ?? 'center'] * width * pixelSize,
          alignmentYMap[(get('anchorY') as keyof typeof alignmentYMap) ?? 'center'] * height * pixelSize,
          0,
        ),
      )
  })
}