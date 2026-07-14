export interface SampleSubTest {
  name: string;
  resultVarId: number;
  resultVarType: string;
  expectedResultValue: unknown[];
  successResultVarId: number;
  successResultVarName: string;
}

export interface SampleMetadata {
  glbFileName: string;
  name: string;
  tests: Array<{
    name: string;
    subTests: SampleSubTest[];
  }>;
}

export interface SampleAsset {
  id: string;
  kind: "test" | "model";
  label: string;
  name: string;
  description?: string;
  tags: string[];
  url: string;
  metadataUrl?: string;
  subtestCount: number;
  runnable: boolean;
}

export interface SampleManifest {
  available: boolean;
  root?: string;
  error?: string;
  assets: SampleAsset[];
  totals: {
    models: number;
    testAssets: number;
    runnableSubtests: number;
  };
}
