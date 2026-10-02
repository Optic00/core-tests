import { type APIRequestContext, expect } from "./context-path";

const BASE_URL = process.env.BASE_URL || "http://localhost:8080";

// CRC-32 (IEEE) — required even for STORED zip entries.
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let bit = 0; bit < 8; bit++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
	name: string;
	data: Uint8Array;
}

// Minimal STORED (uncompressed) zip writer — enough to hand the plugin
// uploader a well-formed archive without a zip dependency.
function buildZip(entries: ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	const u16 = (value: number) => new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
	const u32 = (value: number) =>
		new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
	const concat = (...parts: Uint8Array[]) => {
		const total = parts.reduce((sum, part) => sum + part.length, 0);
		const out = new Uint8Array(total);
		let position = 0;
		for (const part of parts) {
			out.set(part, position);
			position += part.length;
		}
		return out;
	};

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const checksum = crc32(entry.data);
		const localStart = offset;

		chunks.push(
			concat(
				u32(0x04034b50),
				u16(20),
				u16(0),
				u16(0),
				u16(0),
				u16(0),
				u32(checksum),
				u32(entry.data.length),
				u32(entry.data.length),
				u16(name.length),
				u16(0),
				name,
				entry.data,
			),
		);
		offset += 30 + name.length + entry.data.length;

		central.push(
			concat(
				u32(0x02014b50),
				u16(20),
				u16(20),
				u16(0),
				u16(0),
				u16(0),
				u16(0),
				u32(checksum),
				u32(entry.data.length),
				u32(entry.data.length),
				u16(name.length),
				u16(0),
				u16(0),
				u16(0),
				u16(0),
				u32(0),
				u32(localStart),
				name,
			),
		);
	}

	const centralSize = central.reduce((sum, part) => sum + part.length, 0);
	const eocd = concat(
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(entries.length),
		u16(entries.length),
		u32(centralSize),
		u32(offset),
		u16(0),
	);
	return concat(...chunks, ...central, eocd);
}

// Smallest WebAssembly module that the plugin host compiles: one exported
// `init` function with an empty body. Pro capability plugins carry no logic —
// the manifest is the payload.
const MINIMAL_WASM_BASE64 = "AGFzbQEAAAABBAFgAAADAgEABwgBBGluaXQAAAoEAQIACw==";

/**
 * Upload a capability-only plugin (stub wasm + manifest) through the admin
 * plugin endpoint so core exposes the capability via /api/features.
 */
export async function installCapabilityPlugin(
	request: APIRequestContext,
	name: string,
	capabilities: string[],
): Promise<void> {
	const zip = capabilityPluginZip(name, capabilities);

	const response = await request.post(`${BASE_URL}/api/plugins/upload`, {
		headers: { "Sec-Fetch-Site": "same-origin" },
		multipart: {
			plugin: {
				name: `${name}.zip`,
				mimeType: "application/zip",
				buffer: Buffer.from(zip),
			},
		},
	});
	expect(
		response.ok(),
		`plugin upload failed (${response.status()}): ${await response.text()}`,
	).toBeTruthy();
}

/**
 * Remove every capability plugin from a previous run. Uploaded plugins persist
 * on the server's plugin directory across restarts, so specs that assert the
 * absence of a capability must clear leftovers first.
 */
export async function deleteCapabilityPlugins(
	request: APIRequestContext,
	prefix: string,
): Promise<void> {
	const response = await request.get(`${BASE_URL}/api/plugins`, {
		headers: { "Sec-Fetch-Site": "same-origin" },
	});
	if (!response.ok()) return;
	const body = (await response.json()) as
		| Array<{ name?: string; manifest?: { name?: string } }>
		| { data?: Array<{ name?: string; manifest?: { name?: string } }> };
	const plugins = Array.isArray(body) ? body : (body.data ?? []);
	for (const plugin of plugins) {
		const name = plugin.manifest?.name ?? plugin.name;
		if (name && name.startsWith(prefix)) {
			await request.delete(`${BASE_URL}/api/plugins/${name}`, {
				headers: { "Sec-Fetch-Site": "same-origin" },
			});
		}
	}
}

function capabilityPluginZip(name: string, capabilities: string[]): Buffer {
	const manifest = JSON.stringify({
		name,
		version: "1.0.0",
		entryPoint: "plugin.wasm",
		capabilities,
	});
	const wasm = Uint8Array.from(atob(MINIMAL_WASM_BASE64), (c) => c.charCodeAt(0));
	return Buffer.from(
		buildZip([
			{ name: "manifest.json", data: new TextEncoder().encode(manifest) },
			{ name: "plugin.wasm", data: wasm },
		]),
	);
}
