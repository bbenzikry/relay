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

var SignedSource = require("signedsource");

var _require = require("graphql"),
    GraphQLEnumType = _require.GraphQLEnumType;

function writeForSchema(schema, licenseHeader, codegenDir, getModuleName) {
  var header = '/**\n' + licenseHeader.map(function (line) {
    return " * ".concat(line, "\n");
  }).join('') + ' *\n' + " * ".concat(SignedSource.getSigningToken(), "\n") + ' * @flow\n' + ' */\n' + '\n';
  var typeMap = schema.getTypeMap();

  for (var _i = 0, _Object$keys = Object.keys(typeMap); _i < _Object$keys.length; _i++) {
    var name = _Object$keys[_i];
    var type = typeMap[name];

    if (type instanceof GraphQLEnumType) {
      var values = type.getValues().map(function (_ref) {
        var value = _ref.value;
        return value;
      }).sort();
      var enumFileContent = header + "export type ".concat(name, " =\n  | '") + values.join("'\n  | '") + "'\n  | '%future added value';\n";
      codegenDir.writeFile("".concat(getModuleName(name), ".js"), SignedSource.signFile(enumFileContent));
    }
  }
}

module.exports = {
  writeForSchema: writeForSchema
};