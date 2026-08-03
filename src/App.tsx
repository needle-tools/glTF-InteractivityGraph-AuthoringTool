import React, {useRef, useState, useEffect} from 'react';
import {AuthoringComponent} from "./components/AuthoringComponent";
import {EngineType} from "./components/engineViews/EngineType";
import {RenderIf} from "./components/RenderIf";
import {LoggingEngineComponent} from "./components/engineViews/LoggingEngineComponent";
import {BabylonEngineComponent} from "./components/engineViews/BabylonEngineComponent";
import { InteractivityGraphProvider } from './InteractivityGraphContext';
import { SampleSidebar } from './components/SampleSidebar';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';

// Storage key for persisting the engine type
const ENGINE_TYPE_STORAGE_KEY = 'interactivity-graph-engine-type';
// Storage key for persisting whether the graph authoring half is shown
const GRAPH_EDITOR_VISIBLE_STORAGE_KEY = 'interactivity-graph-editor-visible';

export const App = () => {
  const [engineType, setEngineType] = useState<EngineType>(EngineType.BABYLON);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  // hides the whole graph authoring half, leaving the engine view alone in the workspace — for
  // viewing/playing a glb without authoring. The component stays mounted (see app-split__pane
  // --hidden) so toggling back doesn't pay for rebuilding the canvas from the model again.
  const [showGraphEditor, setShowGraphEditor] = useState(true);
  // fraction of the split row's width given to the left (engine) panel; the divider drags this
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [dividerHovered, setDividerHovered] = useState(false);
  const [dividerDragging, setDividerDragging] = useState(false);
  const splitRowRef = useRef<HTMLDivElement | null>(null);

  // drag the divider: track the pointer against the row's bounds and clamp so neither panel collapses
  const startSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    setDividerDragging(true);
    const onMove = (ev: MouseEvent) => {
      const bounds = splitRowRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width === 0) { return; }
      const ratio = (ev.clientX - bounds.left) / bounds.width;
      setSplitRatio(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      setDividerDragging(false);
    };
    // suppress text selection while dragging
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // divider highlights on hover, and stays highlighted (wider grip + accent color) while dragging
  const dividerActive = dividerHovered || dividerDragging;

  // Load stored engine type on initial render and check URL parameters
  useEffect(() => {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    const engineParam = params.get('engine');
    const modelParam = params.get('model');

    // Set engine type from URL parameter or localStorage
    if (engineParam) {
      switch (engineParam.toLowerCase()) {
        case 'logging':
          setEngineType(EngineType.LOGGING);
          break;
        case 'babylon':
          setEngineType(EngineType.BABYLON);
          break;
        default:
          // Load from localStorage if URL param is invalid
          const storedEngineType = localStorage.getItem(ENGINE_TYPE_STORAGE_KEY);
          if (storedEngineType && Object.values(EngineType).includes(storedEngineType as EngineType)) {
            setEngineType(storedEngineType as EngineType);
          }
      }
    } else {
      // No URL param, load from localStorage
      const storedEngineType = localStorage.getItem(ENGINE_TYPE_STORAGE_KEY);
      if (storedEngineType && Object.values(EngineType).includes(storedEngineType as EngineType)) {
        setEngineType(storedEngineType as EngineType);
      }
    }

    // Set model URL from URL parameter
    if (modelParam) {
      setModelUrl(modelParam);
    }

    // Graph editor visibility: URL parameter wins over the stored preference, so a
    // "?graph=hidden" link opens straight into the viewer-only layout
    const graphParam = params.get('graph');
    if (graphParam !== null) {
      setShowGraphEditor(!['hidden', 'off', 'false', '0'].includes(graphParam.toLowerCase()));
    } else {
      const storedGraphVisible = localStorage.getItem(GRAPH_EDITOR_VISIBLE_STORAGE_KEY);
      if (storedGraphVisible !== null) {
        setShowGraphEditor(storedGraphVisible === 'true');
      }
    }
  }, []);

  const toggleGraphEditor = () => {
    setShowGraphEditor(prev => {
      localStorage.setItem(GRAPH_EDITOR_VISIBLE_STORAGE_KEY, String(!prev));
      return !prev;
    });
  };

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      // Get the model URL from the URL parameters
      const params = new URLSearchParams(window.location.search);
      const modelParam = params.get('model');
      const engineParam = params.get('engine');
      
      // Update the model URL state if it exists in the URL
      if (modelParam) {
        setModelUrl(modelParam);
      }
      
      // Update engine type if needed
      if (engineParam) {
        switch (engineParam.toLowerCase()) {
          case 'logging':
            setEngineType(EngineType.LOGGING);
            break;
          case 'babylon':
            setEngineType(EngineType.BABYLON);
            break;
        }
      }
    };

    // Add event listener for popstate
    window.addEventListener('popstate', handlePopState);

    // Clean up the event listener when component unmounts
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Save engine type when it changes
  const handleEngineTypeChange = (type: EngineType) => {
    setEngineType(type);
    localStorage.setItem(ENGINE_TYPE_STORAGE_KEY, type);
    
    // Update URL with engine type
    const params = new URLSearchParams(window.location.search);
    params.set('engine', type.toLowerCase());
    // Keep model parameter if it exists
    if (modelUrl) {
      params.set('model', modelUrl);
    }
    window.history.pushState({ engineType: type, modelUrl }, '', `${window.location.pathname}?${params}`);
  };

  const handleModelUrlChange = (url: string) => {
    setModelUrl(url);
  };

  useEffect(() => {
    if (modelUrl) {
      const params = new URLSearchParams(window.location.search);
      params.set('model', modelUrl);
      // set title based on model name
      const modelName = modelUrl.split('/').pop()?.split('.').shift();
      if (modelName) {
        document.title = `${modelName}`;
      } else {
        document.title = 'glTF Interactivity';
      }
      // only push state if modelUrl is different from current URL parameter
      const currentModelParam = new URLSearchParams(window.location.search).get('model');
      if (currentModelParam !== modelUrl) {
        // Update the URL without reloading the page
        window.history.pushState({ modelUrl }, '', `${window.location.pathname}?${params}`);
      }
    }
  }, [modelUrl]);

  return (
    <InteractivityGraphProvider>
      <div className={"app-shell"}>
        <AppHeader
          setEngineType={handleEngineTypeChange}
          currentEngineType={engineType}
          onSelectModel={handleModelUrlChange}
          showGraphEditor={showGraphEditor}
          onToggleGraphEditor={toggleGraphEditor}
        />

        {/* renders nothing (and takes no space) while there are no diagnostics */}
        <DiagnosticsPanel />

        {/* side-by-side, resizable: 3D/logging engine view on the left, graph authoring on the
            right, with a draggable divider controlling the split (see startSplitDrag) */}
        <main className={"app-main"}>
          <div ref={splitRowRef} className={"app-split"}>
            {/* with the graph pane hidden the engine pane is the only flex item, and a grow factor
                below 1 would leave the rest of the row empty — give it the full width instead */}
            <div className={"app-split__pane"} style={{flexGrow: showGraphEditor ? splitRatio : 1}}>
                <RenderIf shouldShow={engineType === EngineType.LOGGING}>
                     <LoggingEngineComponent modelUrl={modelUrl} />
                </RenderIf>
                <RenderIf shouldShow={engineType === EngineType.BABYLON}>
                    <BabylonEngineComponent modelUrl={modelUrl} />
                </RenderIf>
            </div>
            <RenderIf shouldShow={showGraphEditor}>
                <div
                    role={"separator"}
                    aria-orientation={"vertical"}
                    onMouseDown={startSplitDrag}
                    onMouseEnter={() => setDividerHovered(true)}
                    onMouseLeave={() => setDividerHovered(false)}
                    title={"Drag to resize"}
                    className={`app-divider${dividerActive ? " is-active" : ""}`}
                >
                    <div className={"app-divider__grip"}/>
                </div>
            </RenderIf>
            <div
                className={`app-split__pane${showGraphEditor ? "" : " app-split__pane--hidden"}`}
                style={{flexGrow: 1 - splitRatio}}
            >
                <AuthoringComponent/>
            </div>
          </div>
        </main>
      </div>
    </InteractivityGraphProvider>
  );
}

interface EngineSelectorProps {
    setEngineType: (engine: EngineType) => void;
    currentEngineType: EngineType;
}

// the engine tabs, kept in the order Babylon-then-Logging. Rendered as a plain <ul>/<li>
// segmented control rather than react-bootstrap's <Tabs> so it can carry the app's own styling
// (and so a tab is still an <li>, which the e2e spec clicks).
const ENGINE_TABS: ReadonlyArray<{ engine: EngineType; label: string }> = [
    { engine: EngineType.BABYLON, label: "Babylon Engine" },
    { engine: EngineType.LOGGING, label: "Logging Engine" },
];

export const EngineSelector: React.FC<EngineSelectorProps> = ({ setEngineType, currentEngineType }) => (
    <div data-testid={"engine-selector"}>
        <ul className={"app-tabs"} role={"tablist"}>
            {ENGINE_TABS.map(({ engine, label }) => {
                const isActive = currentEngineType === engine;
                return (
                    <li
                        key={engine}
                        role={"presentation"}
                        className={`app-tab${isActive ? " is-active" : ""}`}
                        onClick={() => setEngineType(engine)}
                    >
                        <button type={"button"} role={"tab"} aria-selected={isActive}>{label}</button>
                    </li>
                );
            })}
        </ul>
    </div>
);

interface AppHeaderProps extends EngineSelectorProps {
    onSelectModel: (url: string) => void;
    showGraphEditor: boolean;
    onToggleGraphEditor: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ setEngineType, currentEngineType, onSelectModel, showGraphEditor, onToggleGraphEditor }) => (
    <header className={"app-header"}>
        <div className={"app-header__brand"}>
            <h1 className={"app-title"}>glTF Interactivity Editor and Viewer</h1>
            <p className={"app-subtitle"}>
                Inspect, run and author glTF files using the{" "}
                <a href="https://github.com/KhronosGroup/glTF/blob/interactivity/extensions/2.0/Khronos/KHR_interactivity/Specification.adoc" target="_blank" rel="noreferrer">KHR_interactivity</a>
                {" "}extension — load a sample or test asset, or build your own graph.
            </p>
        </div>
        <div className={"app-header__actions"}>
            <EngineSelector setEngineType={setEngineType} currentEngineType={currentEngineType} />
            <button
                type={"button"}
                className={"btn-app"}
                onClick={onToggleGraphEditor}
                aria-pressed={!showGraphEditor}
                title={showGraphEditor
                    ? "Hide the graph authoring panel and give the whole workspace to the engine view"
                    : "Show the graph authoring panel again"}
            >
                {showGraphEditor ? "Hide Graph Editor" : "Show Graph Editor"}
            </button>
            <SampleSidebar onSelectModel={onSelectModel} />
        </div>
    </header>
);
