import babel from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from "@rollup/plugin-terser";

export default [
	{
		input: "mutationdiff.mjs",
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
		input: "mutationdiff.mjs",
		output: {
			file: "mutationdiff.min.mjs"
		},
		plugins: [ nodeResolve(), terser() ]
	}
];