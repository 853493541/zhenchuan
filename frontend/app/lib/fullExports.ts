export const EXPORTED_MAP_PACKAGE_NAME = 'Ctest-2026-04-10T23-11-25-797Z';
export const EXPORTED_MAP_DATA_PATH = `/full-exports/${encodeURIComponent(EXPORTED_MAP_PACKAGE_NAME)}/map-data`;

type ExportedMapWarmupStats = {
	manifestCount: number;
	assetCount: number;
	fetchedCount: number;
	failedCount: number;
	durationMs: number;
};

export type ExportedMapAssetList = {
	manifestUrls: string[];
	assetUrls: string[];
	allUrls: string[];
};

const DEFAULT_WARMUP_CONCURRENCY = 3;

let exportedMapWarmupPromise: Promise<ExportedMapWarmupStats> | null = null;

function encodePathSegments(pathLike: string): string {
	return String(pathLike || '')
		.replace(/\\/g, '/')
		.split('/')
		.filter((segment) => segment.length > 0)
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

function normalizeMeshName(raw: unknown): string {
	let name = String(raw || '').trim().replace(/\\/g, '/');
	const slashIndex = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
	if (slashIndex >= 0) name = name.slice(slashIndex + 1);
	if (!name) return '';
	if (!name.toLowerCase().endsWith('.glb')) name += '.glb';
	return name;
}

async function fetchJsonCached<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		cache: 'force-cache',
		credentials: 'same-origin',
	});
	if (!response.ok) throw new Error(`Warmup fetch failed ${response.status}: ${url}`);
	return response.json() as Promise<T>;
}

async function fetchAssetCached(url: string): Promise<boolean> {
	const response = await fetch(url, {
		cache: 'force-cache',
		credentials: 'same-origin',
	});
	if (!response.ok) return false;
	await response.arrayBuffer();
	return true;
}

function addTextureUrl(urls: Set<string>, textureName: unknown) {
	if (typeof textureName !== 'string' || textureName.trim().length === 0) return;
	urls.add(`${EXPORTED_MAP_DATA_PATH}/textures/${encodeURIComponent(textureName.trim())}`);
}

function addTextureSetUrls(urls: Set<string>, textureSet: any) {
	if (!textureSet || typeof textureSet !== 'object') return;
	addTextureUrl(urls, textureSet.albedo);
	addTextureUrl(urls, textureSet.mre);
	addTextureUrl(urls, textureSet.normal);
}

function collectTextureUrls(textureMap: any): string[] {
	const urls = new Set<string>();
	if (!textureMap || typeof textureMap !== 'object') return [];

	for (const textureInfo of Object.values(textureMap)) {
		addTextureSetUrls(urls, textureInfo);
		const subsets = (textureInfo as any)?.subsets;
		if (Array.isArray(subsets)) {
			for (const subset of subsets) addTextureSetUrls(urls, subset);
		}
	}

	return Array.from(urls);
}

function collectGlbUrls(entities: any[], meshMap: Record<string, string>): string[] {
	const urls = new Set<string>();
	for (const entity of entities) {
		const glbRel = meshMap?.[String(entity?.mesh ?? '')];
		if (!glbRel) continue;
		urls.add(`${EXPORTED_MAP_DATA_PATH}/${encodePathSegments(glbRel)}`);
	}
	return Array.from(urls);
}

function collectTerrainUrls(mapConfig: any, terrainTexIndex: any): string[] {
	const urls = new Set<string>();
	const regions = terrainTexIndex?.regions;
	if (!regions || typeof regions !== 'object') return [];

	const mapName = String(mapConfig?.name || '');
	for (const [regionKey, textureInfo] of Object.entries(regions)) {
		const [rawRegionX, rawRegionY] = regionKey.split('_');
		const regionX = Number(rawRegionX);
		const regionY = Number(rawRegionY);
		if (!Number.isFinite(regionX) || !Number.isFinite(regionY)) continue;

		const paddedKey = `${String(regionX).padStart(3, '0')}_${String(regionY).padStart(3, '0')}`;
		urls.add(`${EXPORTED_MAP_DATA_PATH}/heightmap/${encodeURIComponent(`${mapName}_${paddedKey}.bin`)}`);

		const colorTexture = (textureInfo as any)?.color;
		if (typeof colorTexture === 'string' && colorTexture.trim().length > 0) {
			urls.add(`${EXPORTED_MAP_DATA_PATH}/terrain-textures/${encodeURIComponent(colorTexture.trim())}`);
		}
	}

	return Array.from(urls);
}

function collectCollisionUrls(entities: any[], collisionIndex: any): string[] {
	const urls = new Set<string>();
	const sidecarPathByKey = new Map<string, string>();

	if (Array.isArray(collisionIndex?.entries)) {
		for (const entry of collisionIndex.entries) {
			const meshName = normalizeMeshName(entry?.mesh);
			const sidecarRel = String(entry?.sidecar || '').trim();
			if (!meshName || !sidecarRel) continue;
			sidecarPathByKey.set(meshName.toLowerCase(), sidecarRel);
		}
	}

	for (const entity of entities) {
		const meshName = normalizeMeshName(entity?.mesh);
		if (!meshName) continue;
		const meshKey = meshName.toLowerCase();
		const sidecarRel = sidecarPathByKey.get(meshKey) || `meshes/${meshName}.collision.json`;
		urls.add(`${EXPORTED_MAP_DATA_PATH}/${encodePathSegments(sidecarRel)}`);
	}

	return Array.from(urls);
}

async function mapWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let nextIndex = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			await worker(items[currentIndex]);
		}
	}));
}

export async function listExportedMapAssetUrls(): Promise<ExportedMapAssetList> {
	const manifestUrls = [
		`${EXPORTED_MAP_DATA_PATH}/entities/full.rh.json`,
		`${EXPORTED_MAP_DATA_PATH}/mesh-map.json`,
		`${EXPORTED_MAP_DATA_PATH}/map-config.json`,
		`${EXPORTED_MAP_DATA_PATH}/texture-map.json`,
		`${EXPORTED_MAP_DATA_PATH}/terrain-textures/index.json`,
		`${EXPORTED_MAP_DATA_PATH}/mesh-collision-index.json`,
	];

	const [entities, meshMap, mapConfig, textureMap, terrainTexIndex, collisionIndex] = await Promise.all([
		fetchJsonCached<any[]>(manifestUrls[0]),
		fetchJsonCached<Record<string, string>>(manifestUrls[1]),
		fetchJsonCached<any>(manifestUrls[2]),
		fetchJsonCached<any>(manifestUrls[3]).catch(() => null),
		fetchJsonCached<any>(manifestUrls[4]).catch(() => null),
		fetchJsonCached<any>(manifestUrls[5]).catch(() => null),
	]);

	const assetUrls = Array.from(new Set([
		...collectGlbUrls(Array.isArray(entities) ? entities : [], meshMap ?? {}),
		...collectTextureUrls(textureMap),
		...collectTerrainUrls(mapConfig, terrainTexIndex),
		...collectCollisionUrls(Array.isArray(entities) ? entities : [], collisionIndex),
	]));

	return {
		manifestUrls,
		assetUrls,
		allUrls: Array.from(new Set([...manifestUrls, ...assetUrls])),
	};
}

async function runExportedMapWarmup(concurrency: number): Promise<ExportedMapWarmupStats> {
	const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

	try {
		const { manifestUrls, assetUrls } = await listExportedMapAssetUrls();

		let fetchedCount = 0;
		let failedCount = 0;
		await mapWithConcurrency(assetUrls, concurrency, async (url) => {
			const ok = await fetchAssetCached(url).catch(() => false);
			if (ok) fetchedCount += 1;
			else failedCount += 1;
		});

		const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
		return {
			manifestCount: manifestUrls.length,
			assetCount: assetUrls.length,
			fetchedCount,
			failedCount,
			durationMs: endedAt - startedAt,
		};
	} catch (err) {
		const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
		console.warn('[ExportedMapWarmup] failed:', err);
		return {
			manifestCount: manifestUrls.length,
			assetCount: 0,
			fetchedCount: 0,
			failedCount: 1,
			durationMs: endedAt - startedAt,
		};
	}
}

export function warmExportedMapAssets(options: { concurrency?: number } = {}): Promise<ExportedMapWarmupStats> {
	if (typeof window === 'undefined') {
		return Promise.resolve({
			manifestCount: 0,
			assetCount: 0,
			fetchedCount: 0,
			failedCount: 0,
			durationMs: 0,
		});
	}

	if (exportedMapWarmupPromise) return exportedMapWarmupPromise;

	const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_WARMUP_CONCURRENCY, 6));
	exportedMapWarmupPromise = runExportedMapWarmup(concurrency);
	return exportedMapWarmupPromise;
}
