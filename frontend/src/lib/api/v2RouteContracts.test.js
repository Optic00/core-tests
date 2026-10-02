import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve("..");
const metadata = JSON.parse(
	readFileSync(
		join(root, "internal/restapi/v2/contract-metadata.json"),
		"utf8",
	),
).paths;
const normalize = (value) => value.split("?")[0].replace(/\{[^}]*\}/g, "{}");
const routes = Object.entries(metadata).map(([route, methods]) => ({
	route,
	key: normalize(route),
	methods,
}));
const calls = [];

function literal(node) {
	if (!node) return null;
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isTemplateExpression(node)) {
		return (
			node.head.text +
			node.templateSpans.map((span) => `{}${span.literal.text}`).join("")
		);
	}
	return null;
}

function inspect(file) {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			["fetchAPIV2", "fetchV2Data", "fetchAllV2Pages"].includes(
				node.expression.getText(source),
			)
		) {
			const endpoint = literal(node.arguments[0]);
			// Resource-family and computed-path helpers are exercised by runtime API tests.
			if (endpoint?.startsWith("/") && !endpoint.startsWith("/{}")) {
				const options = node.arguments[1];
				const methodProperty =
					options && ts.isObjectLiteralExpression(options)
						? options.properties.find(
								(property) =>
									ts.isPropertyAssignment(property) &&
									property.name.getText(source) === "method",
							)
						: null;
				const method = literal(methodProperty?.initializer) ?? "GET";
				const key = normalize(endpoint);
				calls.push({
					label: `${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${method} ${endpoint}`,
					method: method.toLowerCase(),
					key,
					queryKeys: (endpoint.split("?")[1] ?? "")
						.split("&")
						.map((part) => part.split("=")[0])
						.filter((name) => name && name !== "{}"),
				});
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
}

function scan(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = join(directory, entry.name);
		if (entry.isDirectory()) scan(file);
		else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js"))
			inspect(file);
	}
}
scan(join(root, "frontend/src/lib/api"));

describe("frontend v2 calls match registered server methods", () => {
	it.each(calls)("$label", ({ key, method, queryKeys }) => {
		const match =
			routes.find((route) => route.key === key) ??
			(key.endsWith("{}")
				? routes.find((route) => route.key === key.slice(0, -2))
				: null);
		expect(match, `Unregistered v2 route: ${key}`).toBeDefined();
		expect(
			Object.keys(match.methods),
			`Unsupported method for ${match.route}`,
		).toContain(method);
		const parameters = match.methods[method].parameters
			.filter((parameter) => parameter.In === "query")
			.map((parameter) => parameter.Name);
		for (const name of queryKeys) {
			expect(
				parameters,
				`Undocumented query parameter for ${match.route}`,
			).toContain(name);
		}
	});
});
