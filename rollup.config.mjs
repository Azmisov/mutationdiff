import babel from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from "@rollup/plugin-terser";

export default [
	//*
	{
		input: "src/mutationdiff.mjs",
		output: {
			file: "mutationdiff.compat.min.js",
			name: "MutationDiff",
			format: "iife"
		},
		plugins: [
			babel({ babelHelpers: 'bundled' }),
			nodeResolve(),
			terser()
		]
	},
	{
		input: "src/mutationdiff.mjs",
		output: {
			file: "mutationdiff.min.js"
		},
		plugins: [ nodeResolve(), terser() ]
	},
	//*/
	// add --watch flag to the bundle task when debugging
	{
		input: "tests/tests.js",
		output: {
			file: "tests/tests.bundled.js"
		},
		plugins: [ nodeResolve() ]
	}
];