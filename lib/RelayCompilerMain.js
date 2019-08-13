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

var _asyncToGenerator = require("@babel/runtime/helpers/asyncToGenerator");

var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));

var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(source, true).forEach(function (key) { (0, _defineProperty2["default"])(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

var CodegenRunner = require("./CodegenRunner");

var ConsoleReporter = require("./GraphQLConsoleReporter");

var DotGraphQLParser = require("./DotGraphQLParser");

var RelayFileWriter = require("./RelayFileWriter");

var RelayIRTransforms = require("./RelayIRTransforms");

var RelayLanguagePluginJavaScript = require("./RelayLanguagePluginJavaScript");

var RelaySourceModuleParser = require("./RelaySourceModuleParser");

var WatchmanClient = require("./GraphQLWatchmanClient");

var crypto = require("crypto");

var fs = require("fs");

var invariant = require("fbjs/lib/invariant");

var path = require("path");

var _require = require("graphql"),
    buildASTSchema = _require.buildASTSchema,
    buildClientSchema = _require.buildClientSchema,
    parse = _require.parse,
    printSchema = _require.printSchema;

var commonTransforms = RelayIRTransforms.commonTransforms,
    codegenTransforms = RelayIRTransforms.codegenTransforms,
    fragmentTransforms = RelayIRTransforms.fragmentTransforms,
    printTransforms = RelayIRTransforms.printTransforms,
    queryTransforms = RelayIRTransforms.queryTransforms,
    schemaExtensions = RelayIRTransforms.schemaExtensions;

function buildWatchExpression(config) {
  return ['allof', ['type', 'f'], ['anyof'].concat((0, _toConsumableArray2["default"])(config.extensions.map(function (ext) {
    return ['suffix', ext];
  }))), ['anyof'].concat((0, _toConsumableArray2["default"])(config.include.map(function (include) {
    return ['match', include, 'wholename'];
  })))].concat((0, _toConsumableArray2["default"])(config.exclude.map(function (exclude) {
    return ['not', ['match', exclude, 'wholename']];
  })));
}

function getFilepathsFromGlob(baseDir, config) {
  var extensions = config.extensions,
      include = config.include,
      exclude = config.exclude;
  var patterns = include.map(function (inc) {
    return "".concat(inc, "/*.+(").concat(extensions.join('|'), ")");
  });

  var glob = require("fast-glob");

  return glob.sync(patterns, {
    cwd: baseDir,
    ignore: exclude
  });
}

/**
 * Unless the requested plugin is the builtin `javascript` one, import a
 * language plugin as either a CommonJS or ES2015 module.
 *
 * When importing, first check if it’s a path to an existing file, otherwise
 * assume it’s a package and prepend the plugin namespace prefix.
 *
 * Make sure to always use Node's `require` function, which otherwise would get
 * replaced with `__webpack_require__` when bundled using webpack, by using
 * `eval` to get it at runtime.
 */
function getLanguagePlugin(language) {
  if (language === 'javascript') {
    return RelayLanguagePluginJavaScript();
  } else {
    var languagePlugin;

    if (typeof language === 'string') {
      var pluginPath = path.resolve(process.cwd(), language);
      var requirePath = fs.existsSync(pluginPath) ? pluginPath : "relay-compiler-language-".concat(language);

      try {
        // eslint-disable-next-line no-eval
        languagePlugin = eval('require')(requirePath);

        if (languagePlugin["default"]) {
          languagePlugin = languagePlugin["default"];
        }
      } catch (err) {
        var e = new Error("Unable to load language plugin ".concat(requirePath, ": ").concat(err.message));
        e.stack = err.stack;
        throw e;
      }
    } else {
      languagePlugin = language;
    }

    if (languagePlugin["default"]) {
      // $FlowFixMe - Flow no longer considers statics of functions as any
      languagePlugin = languagePlugin["default"];
    }

    if (typeof languagePlugin === 'function') {
      // $FlowFixMe
      return languagePlugin();
    } else {
      throw new Error('Expected plugin to be a initializer function.');
    }
  }
}

function getPersistQueryFunction(config) {
  var configValue = config.persistFunction;

  if (configValue == null) {
    return null;
  } else if (typeof configValue === 'string') {
    try {
      // eslint-disable-next-line no-eval
      var persistFunction = eval('require')(path.resolve(process.cwd(), configValue));

      if (persistFunction["default"]) {
        return persistFunction["default"];
      }

      return persistFunction;
    } catch (err) {
      var e = new Error("Unable to load persistFunction ".concat(configValue, ": ").concat(err.message));
      e.stack = err.stack;
      throw e;
    }
  } else if (typeof configValue === 'function') {
    return configValue;
  } else {
    throw new Error('Expected persistFunction to be a path string or a function.');
  }
}

function main(_x) {
  return _main.apply(this, arguments);
}

function _main() {
  _main = _asyncToGenerator(function* (config) {
    if (config.verbose && config.quiet) {
      throw new Error("I can't be quiet and verbose at the same time");
    }

    config = getPathBasedConfig(config);
    config = yield getWatchConfig(config); // Use function from module.exports to be able to mock it for tests

    var codegenRunner = module.exports.getCodegenRunner(config);
    var result = config.watch ? yield codegenRunner.watchAll() : yield codegenRunner.compileAll();

    if (result === 'ERROR') {
      process.exit(100);
    }

    if (config.validate && result !== 'NO_CHANGES') {
      process.exit(101);
    }
  });
  return _main.apply(this, arguments);
}

function getPathBasedConfig(config) {
  var schema = path.resolve(process.cwd(), config.schema);

  if (!fs.existsSync(schema)) {
    throw new Error("--schema path does not exist: ".concat(schema));
  }

  var src = path.resolve(process.cwd(), config.src);

  if (!fs.existsSync(src)) {
    throw new Error("--src path does not exist: ".concat(src));
  }

  var persistOutput = config.persistOutput;

  if (typeof persistOutput === 'string') {
    persistOutput = path.resolve(process.cwd(), persistOutput);
    var persistOutputDir = path.dirname(persistOutput);

    if (!fs.existsSync(persistOutputDir)) {
      throw new Error("--persistOutput path does not exist: ".concat(persistOutput));
    }
  }

  return _objectSpread({}, config, {
    schema: schema,
    src: src,
    persistOutput: persistOutput
  });
}

function getWatchConfig(_x2) {
  return _getWatchConfig.apply(this, arguments);
}

function _getWatchConfig() {
  _getWatchConfig = _asyncToGenerator(function* (config) {
    var watchman = config.watchman && (yield WatchmanClient.isAvailable());

    if (config.watch) {
      if (!watchman) {
        throw new Error('Watchman is required to watch for changes.');
      }

      if (!module.exports.hasWatchmanRootFile(config.src)) {
        throw new Error("\n--watch requires that the src directory have a valid watchman \"root\" file.\n\nRoot files can include:\n- A .git/ Git folder\n- A .hg/ Mercurial folder\n- A .watchmanconfig file\n\nEnsure that one such file exists in ".concat(config.src, " or its parents.\n      ").trim());
      }
    } else if (watchman && !config.validate) {
      // eslint-disable-next-line no-console
      console.log('HINT: pass --watch to keep watching for changes.');
    }

    return _objectSpread({}, config, {
      watchman: watchman
    });
  });
  return _getWatchConfig.apply(this, arguments);
}

function getCodegenRunner(config) {
  var _parserConfigs;

  var reporter = new ConsoleReporter({
    verbose: config.verbose,
    quiet: config.quiet
  });
  var schema = getSchema(config.schema);
  var languagePlugin = getLanguagePlugin(config.language);
  var persistQueryFunction = getPersistQueryFunction(config);
  var inputExtensions = config.extensions || languagePlugin.inputExtensions;
  var outputExtension = languagePlugin.outputExtension;
  var sourceParserName = inputExtensions.join('/');
  var sourceWriterName = outputExtension;
  var sourceModuleParser = RelaySourceModuleParser(languagePlugin.findGraphQLTags);
  var providedArtifactDirectory = config.artifactDirectory;
  var artifactDirectory = providedArtifactDirectory != null ? path.resolve(process.cwd(), providedArtifactDirectory) : null;
  var generatedDirectoryName = artifactDirectory || '__generated__';
  var sourceSearchOptions = {
    extensions: inputExtensions,
    include: config.include,
    exclude: ['**/*.graphql.*'].concat((0, _toConsumableArray2["default"])(config.exclude))
  };
  var graphqlSearchOptions = {
    extensions: ['graphql'],
    include: config.include,
    exclude: [path.relative(config.src, config.schema)].concat(config.exclude)
  };
  var parserConfigs = (_parserConfigs = {}, (0, _defineProperty2["default"])(_parserConfigs, sourceParserName, {
    baseDir: config.src,
    getFileFilter: sourceModuleParser.getFileFilter,
    getParser: sourceModuleParser.getParser,
    getSchema: function getSchema() {
      return schema;
    },
    watchmanExpression: config.watchman ? buildWatchExpression(sourceSearchOptions) : null,
    filepaths: config.watchman ? null : getFilepathsFromGlob(config.src, sourceSearchOptions)
  }), (0, _defineProperty2["default"])(_parserConfigs, "graphql", {
    baseDir: config.src,
    getParser: DotGraphQLParser.getParser,
    getSchema: function getSchema() {
      return schema;
    },
    watchmanExpression: config.watchman ? buildWatchExpression(graphqlSearchOptions) : null,
    filepaths: config.watchman ? null : getFilepathsFromGlob(config.src, graphqlSearchOptions)
  }), _parserConfigs);
  var writerConfigs = (0, _defineProperty2["default"])({}, sourceWriterName, {
    writeFiles: getRelayFileWriter(config.src, languagePlugin, config.noFutureProofEnums, artifactDirectory, config.persistOutput, config.customScalars, persistQueryFunction),
    isGeneratedFile: function isGeneratedFile(filePath) {
      return filePath.endsWith('.graphql.' + outputExtension) && filePath.includes(generatedDirectoryName);
    },
    parser: sourceParserName,
    baseParsers: ['graphql']
  });
  var codegenRunner = new CodegenRunner({
    reporter: reporter,
    parserConfigs: parserConfigs,
    writerConfigs: writerConfigs,
    onlyValidate: config.validate,
    // TODO: allow passing in a flag or detect?
    sourceControl: null
  });
  return codegenRunner;
}

function defaultPersistFunction(text) {
  var hasher = crypto.createHash('md5');
  hasher.update(text);
  var id = hasher.digest('hex');
  return Promise.resolve(id);
}

function getRelayFileWriter(baseDir, languagePlugin, noFutureProofEnums, outputDir, persistedQueryPath, customScalars, persistFunction) {
  return (
    /*#__PURE__*/
    function () {
      var _ref2 = _asyncToGenerator(function* (_ref) {
        var onlyValidate = _ref.onlyValidate,
            schema = _ref.schema,
            documents = _ref.documents,
            baseDocuments = _ref.baseDocuments,
            sourceControl = _ref.sourceControl,
            reporter = _ref.reporter;
        var persistQuery;
        var queryMap;

        if (persistFunction != null || persistedQueryPath != null) {
          queryMap = new Map();
          var persistImplmentation = persistFunction || defaultPersistFunction;

          persistQuery =
          /*#__PURE__*/
          function () {
            var _persistQuery = _asyncToGenerator(function* (text) {
              var id = yield persistImplmentation(text);
              !(typeof id === 'string') ? process.env.NODE_ENV !== "production" ? invariant(false, 'Expected persist function to return a string, got `%s`.', id) : invariant(false) : void 0;
              queryMap.set(id, text);
              return id;
            });

            function persistQuery(_x4) {
              return _persistQuery.apply(this, arguments);
            }

            return persistQuery;
          }();
        }

        var results = yield RelayFileWriter.writeAll({
          config: {
            baseDir: baseDir,
            compilerTransforms: {
              commonTransforms: commonTransforms,
              codegenTransforms: codegenTransforms,
              fragmentTransforms: fragmentTransforms,
              printTransforms: printTransforms,
              queryTransforms: queryTransforms
            },
            customScalars: customScalars || {},
            formatModule: languagePlugin.formatModule,
            optionalInputFieldsForFlow: [],
            schemaExtensions: schemaExtensions,
            useHaste: false,
            noFutureProofEnums: noFutureProofEnums,
            extension: languagePlugin.outputExtension,
            typeGenerator: languagePlugin.typeGenerator,
            outputDir: outputDir,
            persistQuery: persistQuery
          },
          onlyValidate: onlyValidate,
          schema: schema,
          baseDocuments: baseDocuments,
          documents: documents,
          reporter: reporter,
          sourceControl: sourceControl
        });

        if (queryMap != null && persistedQueryPath != null) {
          var object = {};
          var _iteratorNormalCompletion = true;
          var _didIteratorError = false;
          var _iteratorError = undefined;

          try {
            for (var _iterator = queryMap.entries()[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
              var _step$value = _step.value,
                  key = _step$value[0],
                  value = _step$value[1];
              object[key] = value;
            }
          } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion && _iterator["return"] != null) {
                _iterator["return"]();
              }
            } finally {
              if (_didIteratorError) {
                throw _iteratorError;
              }
            }
          }

          var data = JSON.stringify(object, null, 2);
          fs.writeFileSync(persistedQueryPath, data, 'utf8');
        }

        return results;
      });

      return function (_x3) {
        return _ref2.apply(this, arguments);
      };
    }()
  );
}

function getSchema(schemaPath) {
  try {
    var source = fs.readFileSync(schemaPath, 'utf8');

    if (path.extname(schemaPath) === '.json') {
      source = printSchema(buildClientSchema(JSON.parse(source).data));
    }

    source = "\n  directive @include(if: Boolean) on FRAGMENT_SPREAD | FIELD | INLINE_FRAGMENT\n  directive @skip(if: Boolean) on FRAGMENT_SPREAD | FIELD | INLINE_FRAGMENT\n\n  ".concat(source, "\n  ");
    return buildASTSchema(parse(source), {
      assumeValid: true
    });
  } catch (error) {
    throw new Error("\nError loading schema. Expected the schema to be a .graphql or a .json\nfile, describing your GraphQL server's API. Error detail:\n\n".concat(error.stack, "\n    ").trim());
  }
} // Ensure that a watchman "root" file exists in the given directory
// or a parent so that it can be watched


var WATCHMAN_ROOT_FILES = ['.git', '.hg', '.watchmanconfig'];

function hasWatchmanRootFile(testPath) {
  while (path.dirname(testPath) !== testPath) {
    if (WATCHMAN_ROOT_FILES.some(function (file) {
      return fs.existsSync(path.join(testPath, file));
    })) {
      return true;
    }

    testPath = path.dirname(testPath);
  }

  return false;
}

module.exports = {
  getCodegenRunner: getCodegenRunner,
  getLanguagePlugin: getLanguagePlugin,
  getWatchConfig: getWatchConfig,
  hasWatchmanRootFile: hasWatchmanRootFile,
  main: main
};