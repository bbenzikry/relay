/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 * @format
 */
'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));

var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(source, true).forEach(function (key) { (0, _defineProperty2["default"])(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

var IRTransformer = require("./GraphQLIRTransformer");

var SchemaUtils = require("./GraphQLSchemaUtils");

var _require = require("./RelayTransformUtils"),
    hasUnaliasedSelection = _require.hasUnaliasedSelection;

var _require2 = require("graphql"),
    assertLeafType = _require2.assertLeafType;

var isAbstractType = SchemaUtils.isAbstractType;
var TYPENAME_KEY = '__typename';
var STRING_TYPE = 'String';
var cache = new Map();
/**
 * A transform that adds `__typename` field on any `LinkedField` of a union or
 * interface type where there is no unaliased `__typename` selection.
 */

function relayGenerateTypeNameTransform(context) {
  cache = new Map();
  var stringType = assertLeafType(context.serverSchema.getType(STRING_TYPE));
  var typenameField = {
    kind: 'ScalarField',
    alias: TYPENAME_KEY,
    args: [],
    directives: [],
    handles: null,
    loc: {
      kind: 'Generated'
    },
    metadata: null,
    name: TYPENAME_KEY,
    type: stringType
  };
  var state = {
    typenameField: typenameField
  };
  return IRTransformer.transform(context, {
    LinkedField: visitLinkedField
  }, function () {
    return state;
  });
}

function visitLinkedField(field, state) {
  var transformedNode = cache.get(field);

  if (transformedNode != null) {
    return transformedNode;
  }

  transformedNode = this.traverse(field, state);

  if (isAbstractType(transformedNode.type) && !hasUnaliasedSelection(transformedNode, TYPENAME_KEY)) {
    transformedNode = _objectSpread({}, transformedNode, {
      selections: [state.typenameField].concat((0, _toConsumableArray2["default"])(transformedNode.selections))
    });
  }

  cache.set(field, transformedNode);
  return transformedNode;
}

module.exports = {
  transform: relayGenerateTypeNameTransform
};