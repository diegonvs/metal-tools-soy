import {joinErrors, toResult, Result} from './util';
import * as chalk from 'chalk';
import * as jsHelpers from './js-helpers';
import * as S from './soy-types';
import * as T from 'babel-types';

function isInternalName(name: string): boolean {
  return name.startsWith('_') || name.endsWith('_');
}

export default function validateInternal(_: S.Program, jsAst: T.Node): Result {
  const params = jsHelpers.getParams(jsAst);

  const missingInternal = params
    .filter(node => {
      const name = jsHelpers.getKeyName(node.key);

      return isInternalName(name) &&
        !jsHelpers.hasAttribute(node.value, 'internal');
    })
    .map(node => jsHelpers.getKeyName(node.key));

  if (!missingInternal.length) {
    return toResult(true);
  }

  return toResult(
    false,
    `Based on their name, these attributes should have the ${chalk.yellow('.internal()')} config added:\n\n` +
    joinErrors(missingInternal));
}
