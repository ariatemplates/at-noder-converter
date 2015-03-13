# at-noder-converter

*at-noder-converter* allows to automatically convert JavaScript files from the current [Aria Templates](http://ariatemplates.com)
class syntax to the new one introduced with the migration to [noder-js](https://github.com/ariatemplates/noder).

It can either be executed as a command line tool, or be integrated in a build process as an
[atpackager](https://github.com/ariatemplates/atpackager) visitor.

## Basic example

Here is a sample file using the current Aria Templates syntax (before the conversion):

```js
Aria.classDefinition({
    $classpath : "x.y.MyClass",
    $dependencies : ["a.b.MyDependency1", "x.y.MyDependency2"],
    $extends : "x.MyBaseClass",
    $prototype : {
        myMethod : function (myParam) {
            return {
                myDep1 : new a.b.MyDependency1(myParam),
                myDep2 : new x.y.MyDependency2(myParam)
            }
        }
    }
});
```

Here is the same file using the new syntax (after the conversion with *at-noder-converter*):

```js
var Aria = require("ariatemplates/Aria");
var aBMyDependency1 = require("a/b/MyDependency1");
var xYMyDependency2 = require("./MyDependency2");
var xMyBaseClass = require("../MyBaseClass");
module.exports = Aria.classDefinition({
    $classpath : "x.y.MyClass",
    $extends : xMyBaseClass,
    $prototype : {
        myMethod : function (myParam) {
            return {
                myDep1 : new aBMyDependency1(myParam),
                myDep2 : new xYMyDependency2(myParam)
            }
        }
    }
});

```

## Conversion process

*at-noder-converter* uses [uglify-js](https://github.com/mishoo/UglifyJS2) to parse JavaScript files.
In the abstract syntax tree, it looks for an Aria Templates definition, which is recognized by
a call to one of the following methods:

* `Aria.classDefinition`
* `Aria.interfaceDefinition`
* `Aria.beanDefinitions`
* `Aria.tplScriptDefinition`

Inside the Aria Templates definition, *at-noder-converter* looks for dependencies, which can be found
in the following properties:

* `$dependencies`
* `$extends`
* `$implements`
* `$resources`
* `$templates`
* `$css`
* `$macrolibs`
* `$csslibs`
* `$texts`
* `$namespaces`

It also looks for references to the Aria Templates [bootstrap classes](at-bootstrap.js) which are sometimes
not declared in Aria Templates classes, as they are always available.

It then replaces each usage of the detected dependencies by a reference to a variable which is declared at
the top of the file, and initialized with a call to `require`.

If both the file and its dependency are inside a common package (e.g. `x.y.Z` and `x.a.B` which are both
in the `x` package), the path in the argument of the call to `require` is relative to the current file
(e.g. `../a/B`). Otherwise (e.g. `x.y.Z` and `z.a.B`), the path in the argument of the call to `require`
is absolute (e.g. `z/a/B`).

As much as possible, comments and code formatting from the original file are kept in the converted file.

## Requirements

The input files to be converted by *at-noder-converter* must respect the following requirements:

* The file should not use the `module` or `require` global variables. (If those variables are
used, it usually means that the file is already converted.)

* There must be exactly one call to one of the Aria Templates definition methods specified in the
previous section. It is not possible to use *at-noder-converter* on a packaged file containing
multiple Aria Templates definitions. Use *at-noder-converter* individually on each file before
packaging them together.

* The parameter of the Aria Templates definition function must be an object literal. For example,
the following class cannot be converted by *at-noder-converter*, because the parameter of
`Aria.classDefinition` is not an object literal but a reference to the `myDefinition` variable:

	```js
	var myDefinition = {
	   $classpath: "a.b.MyClass",
	   $prototype: {}
	};
	Aria.classDefinition(myDefinition);
	```

	But the following class can be converted by *at-noder-converter*:

	```js
	Aria.classDefinition({
	   $classpath: "a.b.MyClass",
	   $prototype: {}
	});
	```

* In a similar way, the `$classpath` property and all the properties which define dependencies
in the Aria Templates definition (cf the list in the previous section) must have static literal
values. For example, the following class cannot be converted by *at-noder-converter* because
the `$classpath` and the `$dependencies` properties contain expressions and not literal values.

	```js
	var myPackage = "a.b.";
	Aria.classDefinition({
	   $classpath: myPackage + "MyClass",
	   $dependencies: [myPackage + "MyOtherClass"],
	   $prototype: {}
	});
	```

	But the following class can be converted by *at-noder-converter*:

	```js
	Aria.classDefinition({
	   $classpath: "a.b.MyClass",
	   $dependencies: ["a.b.MyOtherClass"],
	   $prototype: {}
	});
	```

## Command line tool

This section explains how to use *at-noder-converter* as a command line tool.

### Installation

* Make sure [node.js](http://nodejs.org) is installed (along with [npm](https://www.npmjs.org/doc/README.html)).

* Install *at-noder-converter* from the npm repository with:

```sh
npm install -g at-noder-converter
```

### Usage

Once *at-noder-converter* is installed, it is possible to use it by simply passing the name of the file
to convert. The converted file overwrites the corresponding original file.

For example, if `MyClass.js` contains an Aria Templates class definition, use the following command
to convert it to the new syntax:

```sh
at-noder-converter MyClass.js
```

The `MyClass.js` file now contains the updated class definition.

*at-noder-converter* can also convert multiple files in one command:

```sh
at-noder-converter MyClass1.js MyClass2.js MyClass3.js
```

### Options

The following options can be used to change the behavior:

| Option                    | Description                                                                                                                         |
|---------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `--format`                | Re-format the whole file instead of modifying parts of it. This can lose some comments.                                             |
| `--force-absolute-paths`  | Always use absolute paths in calls to `require()` even if the requiring and required file share some part of the classpath.         |
| `--simplify-single-usage` | If there is only one usage of a dependency, puts the call to `require` where the dependency is used instead of creating a variable. |
| `--remove-unused-imports` | Does not insert statements like `require('someDependency')` when `someDependency` is not used in the current class.                 |
| `--replace-own-classpath` | If a class references itself by its own classpath, replaces this reference by `module.exports`.                                     |
| `--use-short-var-names`   | When requiring `module.foo.Bar`, try assigning it to `Bar` variable instead of `moduleFooBar` whenever possible.                    |

`--remove-unused-imports` might potentially cause troubles if for instance a subclass of a given class used the removed dependency without explicitly declaring it
(which is a bad practice, but might have happened in the codebase by accident). Hence all the removed imports are logged to the standard error stream (`stderr`).

You can also use `--help` option to get the list of available options, and the `--version` option to display the version of
*at-noder-converter*.

## atpackager visitor

This section explains how to use *at-noder-converter* as an [atpackager](https://github.com/ariatemplates/atpackager) visitor, to be
integrated in a build process.

### Installation

Install *at-noder-converter* with npm, as a local dev dependency of your project:

```bash
npm install --save-dev at-noder-converter
```

In your `Gruntfile.js`, include the following line:

```js
require('atpackager').loadNpmPlugin('at-noder-converter');
```

It is now possible to add the `ATNoderConverter` visitor to the list of visitors in the configuration
of *atpackager*.

Here is a sample `Gruntfile.js` which uses *at-noder-converter*:

```js
module.exports = function (grunt) {
   grunt.initConfig({
      atpackager: {
         myBuild: {
            options: {
               sourceDirectories : ['src'],
               sourceFiles: ["**/*"],
               outputDirectory: "build",
               visitors: ["ATNoderConverter"]
            }
         }
      }
   });

   grunt.loadNpmTasks('atpackager');
   require('atpackager').loadNpmPlugin('at-noder-converter');
   grunt.registerTask('default', ['atpackager:myBuild']);
};
```

### Configuration

When adding the `ATNoderConverter` visitor to the `visitors` array, it is possible to specify options
to change the way `ATNoderConverter` behaves.
Here is an example, showing all the accepted configuration parameters, along with their default values:

```js
               visitors: [{
                  type: "ATNoderConverter",
                  cfg: {
                     files: ['**/*.js'],
                     ignoreErrors: ["alreadyConverted", "noAria"],
                     stringBased: true,
                     forceAbsolutePaths: false,
                     simplifySingleUsage: false,
                     removeUnusedImports: false,
                     replaceOwnClasspath: false,
                     useShortVarNames: false
                  }
               }]
```

Here is a description of each parameter:

* **files**: array of file patterns to specify which files have to be converted.

* **ignoreErrors**: array of error ids which, if they are raised, will not fail the build (the corresponding
file will simply not be converted). Only two error ids can be ignored currently, and they are ignored
by default, unless *ignoreErrors* is given another value:

	* **alreadyConverted**: this error happens if the file already uses 'module' or 'require'

	* **noAria**: this error happens if no Aria Templates definition is found in the file

* **stringBased**: if this parameter is true (the default), and if this is possible (depending on
previous visitors), the conversion happens both in the abstract syntax tree representation of the
file and in the string version, allowing to keep file formatting and most comments.
If this parameter is false, changes are only done in the abstract syntax tree, and no effort is made to
keep formatting and comments.

* **forceAbsolutePaths**: if this parameter is true, all the calls to `require()` will use absolute paths,
even if the requiring and required file share some part of the classpath.

* **simplifySingleUsage**: if this parameter is true, if there is only one usage of a dependency,
*at-noder-converter* puts the call to require where the dependency is used instead of creating a variable.

* **removeUnusedImports**: if this parameter is true, when a declared dependency is not used in the current class,
*at-noder-converter* does not insert statements like `require('someDependency')` (which are not assigned to any variable)

* **replaceOwnClasspath**: if this parameter is true, if a class references itself by its own classpath,
*at-noder-converter* replaces this reference by `module.exports`.

* **useShortVarNames**: if this parameter is true, when requiring `module.foo.Bar`, *at-noder-converter*
will try assigning it to `Bar` variable instead of `moduleFooBar`, whenever possible (if it won't create conflicts
with existing variables)


## License

[Apache License 2.0](http://ariatemplates.com/license)
