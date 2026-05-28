declare module 'vue-echarts' {
  import { DefineComponent } from 'vue'
  const VChart: DefineComponent<any, any, any>
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
