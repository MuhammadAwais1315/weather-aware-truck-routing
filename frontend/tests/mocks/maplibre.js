export class FakeMap {
  static instances = []

  constructor(options) {
    this.options = options
    this.sources = new Map()
    this.layers = new Map()
    this.handlers = new Map()
    this.controls = []
    this.removed = false
    this.canvas = {style: {cursor: ''}}
    FakeMap.instances.push(this)
  }

  addControl(control, position) { this.controls.push({control, position}) }
  on(event, layerOrHandler, handler) {
    if (typeof layerOrHandler === 'string') this.handlers.set(`${event}:${layerOrHandler}`, handler)
    else this.handlers.set(event, layerOrHandler)
    if (event === 'load') queueMicrotask(() => layerOrHandler())
  }
  addSource(id, source) {
    const record = {...source, setData: data => {record.data = data}}
    this.sources.set(id, record)
  }
  getSource(id) { return this.sources.get(id) }
  addLayer(layer) { this.layers.set(layer.id, {...layer, layout: layer.layout || {}}) }
  getLayer(id) { return this.layers.get(id) }
  setLayoutProperty(id, key, value) { const layer = this.layers.get(id); if (layer) layer.layout[key] = value }
  setFilter(id, filter) { const layer = this.layers.get(id); if (layer) layer.filter = filter }
  setPaintProperty(id, key, value) { const layer = this.layers.get(id); if (layer) layer.paint[key] = value }
  fitBounds(bounds, options) { this.lastBounds = {bounds, options} }
  isStyleLoaded() { return true }
  getCanvas() { return this.canvas }
  fireLayer(event, layer, payload) { this.handlers.get(`${event}:${layer}`)?.(payload) }
  remove() { this.removed = true; this.sources.clear(); this.layers.clear(); this.handlers.clear() }
}

export class FakePopup {
  static instances = []

  constructor(options) { this.options = options; this.removed = false; FakePopup.instances.push(this) }
  setLngLat(value) { this.lngLat = value; return this }
  setDOMContent(element) { this.element = element; return this }
  addTo() { document.body.append(this.element); return this }
  remove() { this.removed = true; this.element?.remove(); return this }
}

export class FakeLngLatBounds {
  coordinates = []
  extend(coordinate) { this.coordinates.push(coordinate); return this }
  isEmpty() { return this.coordinates.length === 0 }
}

export class FakeNavigationControl {}

export function resetFakeMaps() {
  FakeMap.instances.forEach(map => map.remove())
  FakeMap.instances = []
  FakePopup.instances.forEach(popup => popup.remove())
  FakePopup.instances = []
}
