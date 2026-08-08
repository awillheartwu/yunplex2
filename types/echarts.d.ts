declare module 'vue-echarts' {
  import type { DefineComponent } from 'vue'
  const VChart: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default VChart
}

declare module 'echarts/core' {
  export { use }
}
declare module 'echarts/charts' {
  export { BarChart, LineChart }
}
declare module 'echarts/components' {
  export { TooltipComponent, GridComponent }
}
declare module 'echarts/renderers' {
  export { CanvasRenderer }
}
