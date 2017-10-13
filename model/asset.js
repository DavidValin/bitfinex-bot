'use strict';
/**
 * Represents an asset
 */
class Asset {
  constructor(assetName) {
    this.assetType = 'currency';
    this.assetName = assetName;
    this.assetAmount = 0;
  }
}

module.exports = Asset;
