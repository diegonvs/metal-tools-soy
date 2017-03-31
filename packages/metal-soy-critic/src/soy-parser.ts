import {parseTemplateName, reverseJoin, TemplateName} from './util';
import * as P from 'parsimmon';

/* Parsers */

const closingBrace = P.string('/}');
const colon = P.string(':');
const comma = P.string(',');
const dquote = P.string('"');
const lbracket = P.string('[');
const squote = P.string('\'');
const rbracket = P.string(']');
const rightBrace = P.string('}');

const attributeName = joined(P.letter, P.string('-'));
const html = P.noneOf('{}').many().desc("Html Char");
const namespace = joined(P.letter, P.digit, P.string('.'));
const paramName = joined(P.letter, P.digit, P.string('_'));

const templateName = namespace.map(parseTemplateName);

const namespaceCmd = P.string('{namespace')
  .skip(P.whitespace)
  .then(namespace)
  .skip(rightBrace);

const param = P.lazy(() => nodeMap(
  Param,
  P.string('{param')
    .then(spaced(paramName)),
  P.alt(
    spaced(attribute.many()).skip(rightBrace).then(bodyFor('param')),
    spaced(colon).then(expression(closingBrace)))
));

const mapItem = nodeMap(
  MapItem,
  squote.then(withAny(squote)),
  spaced(colon).then(expression(P.alt(comma, rbracket)))
);

const mapLiteral = nodeMap(
  MapLiteral,
  lbracket.then(P.alt(
    spaced(mapItem).many(),
    P.string(']').result([])))
);

const call = nodeMap(
  Call,
  P.string('{call')
    .skip(P.whitespace)
    .then(templateName),
  P.alt(
    spaced(closingBrace).result([]),
    rightBrace.then(spaced(param).many())
      .skip(spaced(closeCmd('call'))))
);

const attribute = nodeMap(
  Attribute,
  attributeName.skip(P.string('="')),
  withAny(dquote)
);

const paramDeclaration = nodeMap(
  ParamDeclaration,
  P.string('{@param')
    .then(optional(P.string('?')))
    .map(value => !value),
  spaced(paramName),
  spaced(colon)
    .then(withAny(rightBrace))
);

const template = nodeMap(
  Template,
  orAny(P.string('{template'))
    .skip(P.whitespace)
    .then(templateName),
  spaced(attribute).many(),
  spaced(rightBrace).then(spaced(paramDeclaration).many()),
  bodyFor('template')
);

const delTemplate = nodeMap(
  DelTemplate,
  orAny(P.string('{deltemplate'))
    .skip(P.whitespace)
    .then(templateName),
  optional(P.seq(P.whitespace, P.string('variant='))
    .then(interpolation('"'))),
  rightBrace.then(spaced(paramDeclaration).many()),
  bodyFor('deltemplate')
);

const program = nodeMap(
  Program,
  namespaceCmd,
  P.alt(template, delTemplate)
    .atLeast(1)
    .skip(spaced(P.eof))
);

const parser = program;

/* Higher-order Parsers */

export interface Mark {
  start: P.Index;
  end: P.Index;
}

function nodeMap<T, U>(mapper: (mark: Mark, a1: T) => U, p1: P.Parser<T>): P.Parser<U>;
function nodeMap<T, U, V>(mapper: (mark: Mark, a1: T, a2: U) => V, p1: P.Parser<T>, p2: P.Parser<U>): P.Parser<V>;
function nodeMap<T, U, V, W>(mapper: (mark: Mark, a1: T, a2: U, a3: V) => W, p1: P.Parser<T>, p2: P.Parser<U>, p3: P.Parser<V>): P.Parser<W>;
function nodeMap<T, U, V, W, X>(mapper: (mark: Mark, a1: T, a2: U, a3: V, a4: W) => X, p1: P.Parser<T>, p2: P.Parser<U>, p3: P.Parser<V>, p4: P.Parser<W>): P.Parser<X>;
function nodeMap(mapper: any, ...parsers: Array<any>) {
  return P.seq(...parsers)
    .mark()
    .map(({start, value, end}) => {
      return mapper({
        start,
        end
      }, ...value);
    });
}

function optional<T>(parser: P.Parser<T>): P.Parser<T | null> {
  return parser.atMost(1).map(values => values[0] || null);
}

function expression<T>(end: P.Parser<T>): P.Parser<Expression> {
  const spacedEnd = P.optWhitespace.then(end);
  return P.lazy(() =>
    P.alt(mapLiteral.skip(spacedEnd), otherExpression(spacedEnd))
  );
}

function otherExpression<T>(end: P.Parser<T>): P.Parser<OtherExpression> {
  return nodeMap(
    OtherExpression,
    withAny(end)
  );
}

function interpolation(start: string, end: string = start): P.Parser<Interpolation> {
  return nodeMap(
    Interpolation,
    P.string(start).then(withAny(P.string(end)))
  );
}

function cmd(name: string, ...inter: Array<string>): P.Parser<OtherCmd> {
  return nodeMap(
    (mark, body) => MakeCmd(mark, name, body),
    openCmd(name).then(bodyFor(name, ...inter))
  );
}

function bodyFor(name: string, ...inter: Array<String>): P.Parser<Body> {
  const bodyParser: P.Parser<Body> = P.lazy(() =>
    html.then(P.alt(
      closeCmd(name).result([]),
      P.alt(...inter.map(openCmd))
        .result([])
        .then(bodyParser),
      P.seqMap(
        P.alt(
          call,
          cmd('if', 'elseif', 'else'),
          cmd('foreach', 'ifempty'),
          cmd('msg', 'fallbackmsg'),
          cmd('switch'),
          cmd('let'),
          cmd('literal'),
          interpolation('{', '}')),
        bodyParser,
        reverseJoin)))
  );

  return bodyParser;
}

function orAny<T>(parser: P.Parser<T>): P.Parser<T> {
  const newParser: P.Parser<T> = P.lazy(() =>
    parser.or(P.any.then(newParser))
  );

  return newParser;
}

function withAny<T>(parser: P.Parser<T>): P.Parser<string> {
  const newParser: P.Parser<string> = P.lazy(() =>
    P.alt(
      parser.result(''),
      P.seqMap(
        P.any,
        newParser,
        (s, next) => s + next))
  );

  return newParser;
}

function spaced<T>(parser: P.Parser<T>): P.Parser<T> {
  return P.optWhitespace
    .then(parser)
    .skip(P.optWhitespace);
}

function joined(...parsers: Array<P.Parser<string>>): P.Parser<string> {
  return P.alt(...parsers)
    .many()
    .map(values => values.join(''));
}

function closeCmd(name: string): P.Parser<string> {
  return P.string(`{/${name}}`);
}

function openCmd(name: string): P.Parser<string> {
  return P.string(`{${name}`).skip(orAny(rightBrace));
}

/* Nodes */

export type Body = Array<Call | Interpolation | OtherCmd> | Expression;

export type Expression = MapLiteral | OtherExpression;

export interface Node {
  body?: Body,
  mark: Mark,
  type: string
}

export interface Program extends Node {
  body: Array<Template | DelTemplate>,
  namespace: string,
  type: 'Program',
}

function Program(mark: Mark, namespace: string, body: Array<Template>): Program {
  return {
    body,
    mark,
    namespace,
    type: 'Program'
  };
}

export interface Attribute extends Node {
  name: string,
  value: string,
  type: 'Attribute'
}

function Attribute(mark: Mark, name: string, value: string): Attribute {
  return {
    mark,
    name,
    value,
    type: 'Attribute'
  };
}

export interface OtherExpression extends Node {
  type: 'OtherExpression';
  content: string;
}

function OtherExpression(mark: Mark, content: string): OtherExpression {
  return {
    content,
    mark,
    type: 'OtherExpression'
  };
}

export interface MapLiteral extends Node {
  items: Array<MapItem>;
  type: 'MapLiteral';
}

function MapLiteral(mark:Mark, items: Array<MapItem>): MapLiteral {
  return {
    items,
    mark,
    type: 'MapLiteral'
  };
}

export interface MapItem extends Node {
  type: 'MapItem';
  key: string;
  value: Expression;
}

function MapItem(mark: Mark, key: string, value: Expression): MapItem {
  return {
    mark,
    key,
    value,
    type: 'MapItem'
  };
}

export interface Template extends Node {
  attributes: Array<Attribute>,
  body: Body,
  id: TemplateName,
  params: Array<ParamDeclaration>,
  type: 'Template'
}

function Template(
  mark: Mark,
  id: TemplateName,
  attributes: Array<Attribute>,
  params: Array<ParamDeclaration> = [],
  body: Body = [])
  : Template {

  return {
    attributes,
    body,
    mark,
    id,
    params,
    type: 'Template'
  };
}

export interface DelTemplate extends Node {
  body: Body,
  id: TemplateName,
  params: Array<ParamDeclaration>,
  variant: Interpolation | null,
  type: 'DelTemplate'
}

function DelTemplate(
  mark: Mark,
  id: TemplateName,
  variant: Interpolation | null,
  params: Array<ParamDeclaration> = [],
  body: Body = [])
  : DelTemplate {

  return {
    body,
    mark,
    id,
    params,
    variant,
    type: 'DelTemplate'
  };
}

export interface Interpolation extends Node {
  content: string,
  type: 'Interpolation'
}

function Interpolation(mark: Mark, content: string): Interpolation {
  return {
    content,
    mark,
    type: 'Interpolation'
  };
}

export interface Param extends Node {
  body: Body,
  mark: Mark,
  name: string,
  type: 'Param',
}

function Param(mark: Mark, name: string, body: Body): Param {
  return {
    body,
    mark,
    name,
    type: 'Param'
  };
}

export interface ParamDeclaration extends Node {
  name: string,
  paramType: string,
  required: boolean,
  type: 'ParamDeclaration'
}

function ParamDeclaration(
  mark: Mark,
  required: boolean,
  name: string,
  paramType: string)
  : ParamDeclaration {
  return {
    mark,
    name,
    paramType,
    required,
    type: 'ParamDeclaration'
  };
}

export interface Call extends Node {
  mark: Mark;
  body: Array<Param>,
  id: TemplateName,
  type: 'Call'
}

function Call(mark: Mark, id: TemplateName, body: Array<Param> = []): Call {
  return {
    mark,
    body,
    id,
    type: 'Call'
  };
}

export interface OtherCmd extends Node {
  body: Body
}

function MakeCmd(mark: Mark, name: string, body: Body = []): OtherCmd {
  return {
    body,
    mark,
    type: name.charAt(0).toUpperCase() + name.slice(1)
  };
}

export class SoyParseError extends Error {}

export default function parse(input: string): Program {
  const result = parser.parse(input);
  if (!result.status) {
    throw new SoyParseError('Failed to parse soy template');
  }
  return result.value;
};
