/**
 * leaflet-rastercoords — plain image map projection for Leaflet.
 *
 * Adapted as ES module from https://github.com/commenthol/leaflet-rastercoords
 * @copyright 2016 commenthol
 * @license MIT
 */

/* global L */

/**
 * @param {L.Map} map - the Leaflet map instance
 * @param {number[]} imgsize - [width, height] of the source image in pixels
 * @param {number} [tilesize=256] - tile size in pixels
 */
L.RasterCoords = function (map, imgsize, tilesize) {
  this.map = map;
  this.width = imgsize[0];
  this.height = imgsize[1];
  this.tilesize = tilesize || 256;
  this.zoom = this.zoomLevel();
  if (this.width && this.height) {
    this.setMaxBounds();
  }
};

L.RasterCoords.prototype = {
  /**
   * Calculate the maximum native zoom level for the given image size.
   * @returns {number}
   */
  zoomLevel: function () {
    return Math.ceil(
      Math.log(
        Math.max(this.width, this.height) / this.tilesize
      ) / Math.log(2)
    );
  },

  /**
   * Unproject pixel coords [x, y] to Leaflet LatLng at the native zoom.
   * @param {number[]} coords - [x, y] in image‐pixel space (y = 0 at top)
   * @returns {L.LatLng}
   */
  unproject: function (coords) {
    return this.map.unproject(coords, this.zoom);
  },

  /**
   * Project a Leaflet LatLng back to image‐pixel coords.
   * @param {L.LatLng} coords
   * @returns {L.Point}
   */
  project: function (coords) {
    return this.map.project(coords, this.zoom);
  },

  /**
   * Set the map's max bounds to exactly the image extents.
   */
  setMaxBounds: function () {
    var southWest = this.unproject([0, this.height]);
    var northEast = this.unproject([this.width, 0]);
    this.map.setMaxBounds(new L.LatLngBounds(southWest, northEast));
  }
};
