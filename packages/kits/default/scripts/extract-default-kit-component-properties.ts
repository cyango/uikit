import { readdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { Converter, mapIncludesAllKeys, mapToRecord } from '../../../../scripts/shared.js'

import * as DefaultKit from '../src/components.js'

const components = Object.keys(DefaultKit)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const fileExtensionRegex = /\.[^\.]+$/

const componentNames = readdirSync(resolve(__dirname, '../src')).map((fileName) => {
  fileName = fileName.replace(fileExtensionRegex, '')
  return fileName[0].toUpperCase() + fileName.slice(1).replace(/-./g, (x) => x[1].toUpperCase())
})

const converter = new Converter(resolve(__dirname, '../src/components.ts'))

const conversionComponentMap = new Map<string, Array<string>>()
const imports: Array<string> = []

const containerPropertyTypes = converter.extractPropertyTypes(converter.getSchema(`ContainerProperties`))
const imagePropertyTypes = converter.extractPropertyTypes(converter.getSchema(`ImageProperties`))
const inputPropertyTypes = converter.extractPropertyTypes(converter.getSchema(`InputProperties`))

for (const component of components) {
  if (component === 'Defaults' || component.charAt(0).toUpperCase() != component.charAt(0)) {
    continue
  }
  const schema = converter.getSchema(`${component}Properties`)
  imports.push(component) //TODO
  const propertyTypes = converter.extractPropertyTypes(schema)
  const componentName = componentNames.find((name) => component.includes(name))
  if (componentName == null) {
    throw new Error(`no corresponding component name found for component "${component}"`)
  }
  let conversionComponents = conversionComponentMap.get(componentName)
  if (conversionComponents == null) {
    conversionComponentMap.set(componentName, (conversionComponents = []))
  }
  conversionComponents.push(`${component}: {
    componentName: '${component}',
    componentImpl: ${component},
    children: ${converter.hasChildren(schema) ? 'undefined' : "'none'"},
    propertyTypes: [${
      mapIncludesAllKeys(propertyTypes, inputPropertyTypes)
        ? `...conversionPropertyTypes.Input, ${JSON.stringify(mapToRecord(propertyTypes, inputPropertyTypes))}`
        : mapIncludesAllKeys(propertyTypes, imagePropertyTypes)
          ? `...conversionPropertyTypes.Image, ${JSON.stringify(mapToRecord(propertyTypes, imagePropertyTypes))}`
          : mapIncludesAllKeys(propertyTypes, containerPropertyTypes)
            ? `...conversionPropertyTypes.Container, ${JSON.stringify(mapToRecord(propertyTypes, containerPropertyTypes))}`
            : `conversionPropertyTypes.Inheriting, ${JSON.stringify(mapToRecord(propertyTypes))}`
    }],
  },`)
}

writeFileSync(
  resolve(__dirname, '../src/convert.ts'),
  `
import { ConversionComponentMap, conversionPropertyTypes } from '@react-three/uikit'
import { ${imports.join(',\n')} } from "./index.js"

export const componentMap: ConversionComponentMap = {
    ${Array.from(conversionComponentMap).map(([name, codes]) => `${name}: { ${codes.join('\n')} }`)}
}

`,
)
