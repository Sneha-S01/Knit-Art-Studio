/**
 * palettes.js
 * Predefined yarn color palettes for quantization.
 * Each palette is an array of hex color strings.
 */

const PALETTES = {
  /**
   * Uses the image's own colors via k-means clustering.
   * null signals the renderer to run k-means instead.
   */
  original: null,

  nordic: [
    '#f5f0e8', '#e8dcc8', '#c0a882', '#7f8c8d',
    '#4a5568', '#1a2332', '#c0392b', '#922b21'
  ],

  autumn: [
    '#fdf2e0', '#f5c97a', '#E8A14E', '#D4610C',
    '#9a3515', '#8B2500', '#4a3728', '#2c1f13'
  ],

  sage: [
    '#f5f0e8', '#d4e8d0', '#a8c8a8', '#7aab7a',
    '#5a8a6a', '#3d6e4e', '#2d4a3e', '#c8b89a'
  ],

  twilight: [
    '#f0c8e8', '#d898d0', '#b87ac8', '#9050a8',
    '#6a2080', '#4a0868', '#2a0448', '#1a0533'
  ]
};
