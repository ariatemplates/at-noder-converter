/*
 * Copyright 2013 Amadeus s.a.s.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports = function (atpackager) {
    var process = require("../process")(atpackager.uglify);
    var grunt = atpackager.grunt;
    var uglifyContentProvider = atpackager.contentProviders.uglifyJS;

    var ATNoderConverter = function (cfg) {
        cfg = cfg || {};
        this.files = cfg.files || ['**/*.js'];
    };

    ATNoderConverter.prototype.onWriteInputFile = function (packaging, outputFile, inputFile) {
        if (!inputFile.isMatch(this.files)) {
            return;
        }
        var ast = uglifyContentProvider.getAST(inputFile);
        if (ast) {
            try {
                process(ast);
                grunt.verbose.writeln("[ATNoderConverter] Converted " + inputFile.logicalPath.yellow + " successfully.");
                inputFile.contentProvider = uglifyContentProvider; // makes sure the changed version is used
            } catch (e) {
                grunt.log.error("[ATNoderConverter] Could not convert " + inputFile.logicalPath.yellow + ": " + e);
            }
        }
    };
    return ATNoderConverter;
};