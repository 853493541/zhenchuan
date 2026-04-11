import { MeshBVH, MeshBVHOptions } from '../index.js';
import { BufferGeometry } from '/lib/three.module.js';

export class GenerateMeshBVHWorker {

	generate( geometry: BufferGeometry, options: MeshBVHOptions ): Promise<MeshBVH>;

}

export class ParallelMeshBVHWorker extends GenerateMeshBVHWorker {

	maxWorkerCount: number;

}
