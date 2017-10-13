'use strict';
/**
 * Represents a pair
 */
class Pair {
  constructor(name) {
    this.name = name;
  }

  /**
   * Retrieves the source currency from a pair
   */
  getSourceCurrency() {
    return this.name.substr(0,3);
  }

  /**
   * Retrieves the target currency from a pair
   */
  getTargetCurrency(pair) {
    return this.name.substr(3,5);
  }
}

module.exports = Pair;
