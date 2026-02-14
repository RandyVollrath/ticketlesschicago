declare module 'leaflet.heat' {
  // Side-effect import - adds L.heatLayer to leaflet namespace
}

declare module 'leaflet.markercluster' {
  // Side-effect import - adds L.markerClusterGroup to leaflet namespace
}

declare module 'leaflet.markercluster/dist/MarkerCluster.css' {
  const content: string;
  export default content;
}

declare module 'leaflet.markercluster/dist/MarkerCluster.Default.css' {
  const content: string;
  export default content;
}
