import compileSoy from 'metal-tools-soy/lib/pipelines/compileSoy';
import fs from 'fs';
import glob from 'glob';
import path from 'path';
import soyparser, { traverse } from 'soyparser';
import vfs from 'vinyl-fs';

const filePathAstMap = {};

const globs = {};

const namespaceAstMap = {};

/**
 * metal-soy-loader
 */
export default function metalSoyLoader() {
	const loaderCallback = this.async();

	let resourcePath = this.resourcePath;

	if (path.extname(resourcePath) === '.js') {
		resourcePath = resourcePath.substring(0, resourcePath.indexOf('.js'));
	}

	const templates = resolveGlob('**/*.soy');

	let soyDeps = templates.filter(filePath => /node_modules/.test(filePath));

	templates.forEach(filePath => {
		getParsedSoy(filePath);
	});

	/**
	* @param error
	* @param result
	*/
	const handleEnd = (error, result) => {
		loaderCallback(error, result);
	};

	/**
	 * @param error
	 */
	const handleError = error => {
		handleEnd(error);
	};

	const externalCalls = getExternalSoyCalls(
		getParsedSoy(resourcePath),
		namespaceAstMap,
	);

	const internalSoyDeps = resolveInternalSoyDeps(templates, externalCalls);

	soyDeps = soyDeps.concat(internalSoyDeps);

	let stream = vfs.src(resourcePath).pipe(
		compileSoy({
			soyDeps,
		}).on('error', handleError),
	);

	stream.on('data', file => {
		handleEnd(null, file.contents.toString());
	});
	stream.on('error', handleError);
}

/**
 * Gets namespaces of external soy calls
 * @param {!Object} soyAst parsed soy ast
 * @param {!Object} namespaceAstMap object literal that maps namespace to parsed soy ast
 * @return {Array}
 */
function getExternalSoyCalls(soyAst, namespaceAstMap) {
	let calls = [];

	traverse.visit(soyAst, {
		Call: node => {
			if (node.id.namespace) {
				calls.push(node.id.namespace);
			}
		},
	});

	calls.forEach(namespace => {
		calls = getExternalSoyCalls(
			namespaceAstMap[namespace],
			namespaceAstMap,
		).concat(calls);
	});

	return calls;
}

/**
 * Gets parsed soy ast
 * @param {!string} filePath
 * @return {Object}
 */
function getParsedSoy(filePath) {
	if (!filePathAstMap[filePath]) {
		const soyAst = soyparser(fs.readFileSync(filePath, 'utf8'));

		filePathAstMap[filePath] = soyAst;
		namespaceAstMap[soyAst.namespace] = soyAst;
	}
	return filePathAstMap[filePath];
}

/**
 * Resolves glob file pattern
 * @param {!string} pattern file glob pattern
 * @return {Array} list of file paths
 */
function resolveGlob(pattern) {
	if (!globs[pattern]) {
		globs[pattern] = glob
			.sync(pattern)
			.map(filePath => path.resolve(filePath));
	}

	return globs[pattern];
}

/**
 * Resolves list of soy dependencies based on external soy calls
 * @param {!Array} filePaths array of file paths
 * @param {!Array} externalCalls array of soy namespaces
 */
function resolveInternalSoyDeps(filePaths, externalCalls) {
	return filePaths.filter(filePath => {
		const soyAst = getParsedSoy(filePath);

		return externalCalls.indexOf(soyAst.namespace) > -1;
	});
}
