import { Object3D } from 'three'
import { ImageProperties, createImage, destroyImage } from '../components/image'
import { AllOptionalProperties } from '../properties/default'
import { Component } from '.'
import { EventConfig, bindHandlers } from './utils'
import { batch } from '@preact/signals-core'

export class Image extends Object3D {
  public readonly internals: ReturnType<typeof createImage>
  public readonly eventConfig: EventConfig

  private container: Object3D

  constructor(parent: Component, properties: ImageProperties, defaultProperties?: AllOptionalProperties) {
    super()
    this.eventConfig = parent.eventConfig
    this.container = new Object3D()
    this.container.matrixAutoUpdate = false
    this.container.add(this)
    this.matrixAutoUpdate = false
    parent.add(this.container)
    this.internals = createImage(
      parent.internals,
      properties,
      defaultProperties,
      { current: this },
      { current: this.container },
    )
    this.setProperties(properties, defaultProperties)

    this.container.add(this.internals.mesh)
    bindHandlers(this.internals, this, this.internals.mesh, this.eventConfig)
  }

  setProperties(properties: ImageProperties, defaultProperties?: AllOptionalProperties) {
    batch(() => {
      this.internals.propertiesSignal.value = properties
      this.internals.defaultPropertiesSignal.value = defaultProperties
    })
  }

  destroy() {
    this.container.parent?.remove(this.container)
    destroyImage(this.internals)
  }
}