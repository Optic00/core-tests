import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const website =
	process.env.WINDSHIFT_WEBSITE_ROOT ||
	fileURLToPath(
		new URL("../../../../websites/windshift-website", import.meta.url),
	);
const { generateApiDocs, apiDocsPlugin } = await import(
	/* @vite-ignore */ pathToFileURL(join(website, "scripts/api-docs.js")).href
);
const directories = [];
function fixture(value) {
	const directory = mkdtempSync(join(tmpdir(), "api-docs-test-"));
	directories.push(directory);
	const path = join(directory, "openapi.json");
	writeFileSync(path, JSON.stringify(value));
	return path;
}
const spec = {
	openapi: "3.0.3",
	info: { title: "Fixture API", version: "2.0.0" },
	servers: [{ url: "/rest/api/v2" }],
	paths: {
		"/items": { get: { responses: { 200: { description: "Items" } } } },
	},
};
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe("website API documentation publication", () => {
	it("publishes the exact v2 source without obsolete Redoc assets", () => {
		const path = fixture(spec);
		const assets = generateApiDocs(path);
		expect(Object.keys(assets)).toEqual(["rest-api/openapi.json"]);
		expect(assets["rest-api/openapi.json"]).toBe(readFileSync(path, "utf8"));
	});
	it("reads the latest spec for each build rather than caching an old copy", () => {
		const path = fixture(spec);
		generateApiDocs(path);
		const updated = { ...spec, info: { ...spec.info, version: "2.1.0" } };
		writeFileSync(path, JSON.stringify(updated));
		const emitted = [];
		apiDocsPlugin(path).generateBundle.call({
			emitFile: (asset) => emitted.push(asset),
		});
		expect(
			emitted.find((asset) => asset.fileName === "rest-api/openapi.json"),
		).toEqual({
			type: "asset",
			fileName: "rest-api/openapi.json",
			source: JSON.stringify(updated),
		});
	});
	it("rejects a v1 spec instead of silently publishing the deprecated API", () => {
		expect(() =>
			generateApiDocs(
				fixture({
					...spec,
					info: { ...spec.info, version: "1.0.0" },
					servers: [{ url: "/rest/api/v1" }],
				}),
			),
		).toThrow(/requires the Windshift v2 spec/);
	});
	it("fails when the source is missing", () => {
		const path = fixture(spec);
		rmSync(path);
		expect(() => generateApiDocs(path)).toThrow(/ENOENT/);
	});
	it.each([{}, { ...spec, paths: {} }, { ...spec, openapi: "2.0" }])(
		"rejects invalid spec %j",
		(value) => {
			expect(() => generateApiDocs(fixture(value))).toThrow(
				/requires an OpenAPI/,
			);
		},
	);
	it.each(["#/components/schemas/Missing", "other.json#/Schema"])(
		"rejects unresolved or external reference %s",
		(ref) => {
			expect(() =>
				generateApiDocs(
					fixture({
						...spec,
						components: { schemas: { Item: { $ref: ref } } },
					}),
				),
			).toThrow(/OpenAPI reference/);
		},
	);
	it("accepts recursive internal schema references", () => {
		const recursive = {
			...spec,
			components: {
				schemas: {
					Item: {
						properties: { child: { $ref: "#/components/schemas/Item" } },
					},
				},
			},
		};
		expect(generateApiDocs(fixture(recursive))["rest-api/openapi.json"]).toBe(
			JSON.stringify(recursive),
		);
	});
});
