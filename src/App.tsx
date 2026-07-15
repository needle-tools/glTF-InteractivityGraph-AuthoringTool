import React, {useRef, useState, useEffect} from 'react';
import {AuthoringComponent} from "./components/AuthoringComponent";
import {EngineType} from "./components/engineViews/EngineType";
import {RenderIf} from "./components/RenderIf";
import {LoggingEngineComponent} from "./components/engineViews/LoggingEngineComponent";
import {BabylonEngineComponent} from "./components/engineViews/BabylonEngineComponent";
import {ThreeEngineComponent} from "./components/engineViews/ThreeEngineComponent";
import {NeedleEngineComponent} from "./components/engineViews/NeedleEngineComponent";
import {Tab, Tabs} from "react-bootstrap";
import { InteractivityGraphProvider } from './InteractivityGraphContext';
import { SampleSidebar } from './components/SampleSidebar';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';

// Storage key for persisting the engine type
const ENGINE_TYPE_STORAGE_KEY = 'interactivity-graph-engine-type';

const engineTypeFromString = (value: string | null): EngineType | undefined => {
  switch (value?.toLowerCase()) {
    case 'logging': return EngineType.LOGGING;
    case 'babylon': return EngineType.BABYLON;
    case 'three': return EngineType.THREE;
    case 'needle': return EngineType.NEEDLE;
    default: return undefined;
  }
};

const getInitialEngineType = (): EngineType => {
  const engineParam = new URLSearchParams(window.location.search).get('engine');
  return engineTypeFromString(engineParam)
    ?? engineTypeFromString(localStorage.getItem(ENGINE_TYPE_STORAGE_KEY))
    ?? EngineType.BABYLON;
};

export const App = () => {
  const [engineType, setEngineType] = useState<EngineType>(getInitialEngineType);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
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
        case 'three':
          setEngineType(EngineType.THREE);
          break;
        case 'needle':
          setEngineType(EngineType.NEEDLE);
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
  }, []);

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
          case 'three':
            setEngineType(EngineType.THREE);
            break;
          case 'needle':
            setEngineType(EngineType.NEEDLE);
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
        <div className="app-shell">

        <EngineSelector setEngineType={handleEngineTypeChange} currentEngineType={engineType} />

        <SampleSidebar onSelectModel={handleModelUrlChange} />

        <DiagnosticsPanel />

        {/* side-by-side, resizable: 3D/logging engine view on the left, graph authoring on the
            right, with a draggable divider controlling the split (see startSplitDrag) */}
        <div ref={splitRowRef} className="app-workspace">
            <div className="app-engine-pane" style={{flexGrow: splitRatio}}>
                <RenderIf shouldShow={engineType === EngineType.LOGGING}>
                     <LoggingEngineComponent modelUrl={modelUrl} />
                </RenderIf>
                <RenderIf shouldShow={engineType === EngineType.BABYLON}>
                    <BabylonEngineComponent modelUrl={modelUrl} />
                </RenderIf>
                <RenderIf shouldShow={engineType === EngineType.THREE}>
                    <ThreeEngineComponent modelUrl={modelUrl} />
                </RenderIf>
                <RenderIf shouldShow={engineType === EngineType.NEEDLE}>
                    <NeedleEngineComponent modelUrl={modelUrl} />
                </RenderIf>
            </div>
            <div
                className={`app-workspace-divider${dividerActive ? " app-workspace-divider--active" : ""}`}
                onMouseDown={startSplitDrag}
                onMouseEnter={() => setDividerHovered(true)}
                onMouseLeave={() => setDividerHovered(false)}
                title={"Drag to resize"}
            >
                <div className="app-workspace-divider__handle"/>
            </div>
            <div className="app-graph-pane" style={{flexGrow: 1 - splitRatio}}>
                <AuthoringComponent/>
            </div>
        </div>
      </div>
    </InteractivityGraphProvider>
      
  );
}

interface EngineSelectorProps {
    setEngineType: (engine: EngineType) => void;
    currentEngineType: EngineType;
}

export const EngineSelector: React.FC<EngineSelectorProps> = ({ setEngineType, currentEngineType }) => {
    // Initialize the activeKey based on the engineType prop
    const getInitialTabKey = () => {
        switch (currentEngineType) {
            case EngineType.LOGGING:
                return '1';
            case EngineType.BABYLON:
                return '2';
            case EngineType.THREE:
                return '3';
            case EngineType.NEEDLE:
                return '4';
            default:
                return '2'; // Default to Babylon
        }
    };

    const [activeKey, setActiveKey] = useState(getInitialTabKey());
    
    // Update tab key when engineType changes
    useEffect(() => {
        setActiveKey(getInitialTabKey());
    }, [currentEngineType]);
    
    const handleEngineChange = (key: string | null) => {
        if (key) {
            let engine;
            switch (key) {
                case '1':
                    engine = EngineType.LOGGING;
                    break;
                case '2':
                    engine = EngineType.BABYLON;
                    break;
                case '3':
                    engine = EngineType.THREE;
                    break;
                case '4':
                    engine = EngineType.NEEDLE;
                    break;
                default:
                    throw Error("Invalid Selection")
            }
            setActiveKey(key);
            setEngineType(engine);
        }
    };

    return (
        <div className="engine-selector">
            <h1 className="engine-selector__title">glTF Interactivity Editor and Viewer</h1>
            <div className="engine-selector__intro">
                <p>This web app allows interacting with, graph inspection and authoring of glTF files using the <a href="https://github.com/KhronosGroup/glTF/blob/interactivity/extensions/2.0/Khronos/KHR_interactivity/Specification.adoc" target="_blank" rel="noreferrer">KHR_interactivity</a> extension.</p>
                <p>You can load samples and test assets and inspect their graphs, or create your own files with the experimental graph UI.</p>
            </div>
            <div className="engine-selector__tabs" data-testid={"engine-selector"}>
                <Tabs
                    activeKey={activeKey}
                    onSelect={handleEngineChange}
                >
                    <Tab title={"Babylon"} eventKey={2}/>
                    <Tab title={"three.js"} eventKey={3}/>
                    <Tab title={"Needle"} eventKey={4}/>
                    <Tab title={"Debug"} eventKey={1}/>
                </Tabs>
            </div>
        </div>
    );
}
