#!/usr/bin/env node
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

var optimist = require("optimist").usage("Convert JavaScript files from the current Aria Templates class syntax to the new one introduced with the migration to noder-js.\nUsage:\n at-noder-converter [file1.js [file2.js [file3.js ...]]]").options({
    "help" : {
        description : "Displays this help message and exits."
    },
    "version" : {
        description : "Displays the version number and exits."
    },
    "format" : {
        boolean : true,
        description : "Re-format the whole file instead of modifying parts of it. This can lose some comments."
    },
    "simplify-single-usage" : {
        boolean : true,
        description : "If there is only one usage of a dependency, puts the call to require where the dependency is used instead of creating a variable."
    },
    "replace-own-classpath" : {
        boolean : true,
        description : "If a class references itself by its own classpath, replaces this reference by module.exports."
    }
});
var argv = optimist.argv;

var convertFiles = function () {
    var converter = require("./main");
    var successes = 0;
    var errors = 0;
    argv._.forEach(function (file) {
        try {
            converter(file, {
                simplifySingleUsage : argv['simplify-single-usage'],
                replaceOwnClasspath : argv['replace-own-classpath'],
                format : argv.format
            });
            successes++;
            console.log(file + ": OK");
        } catch (e) {
            console.log(file + ": ERROR");
            console.error(file + ": " + e.message);
            if (argv.stack) {
                console.error(e.stack);
            }
            errors++;
        }
    });

    console.log("\nConversion finished, %d file(s) successfully converted, %d file(s) could not be converted.", successes, errors);
    process.on("exit", function () {
        process.exit(errors > 0 ? 1 : 0);
    });
};

if (argv.help) {
    optimist.showHelp();
} else if (argv.version) {
    console.log(require("./package.json").version);
} else {
    convertFiles();
}