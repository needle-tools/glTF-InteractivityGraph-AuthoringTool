import React, {useRef, useState, useEffect} from 'react';
import {AuthoringComponent} from "./components/AuthoringComponent";
import {EngineType} from "./components/engineViews/EngineType";
import {RenderIf} from "./components/RenderIf";
import {LoggingEngineComponent} from "./components/engineViews/LoggingEngineComponent";
import {BabylonEngineComponent} from "./components/engineViews/BabylonEngineComponent";
import {ThreeEngineComponent} from "./components/engineViews/ThreeEngineComponent";
import {Tab, Tabs} from "react-bootstrap";
import {Spacer} from "./components/Spacer";
import { InteractivityGraphProvider } from './InteractivityGraphContext';

// Storage key for persisting the engine type
const ENGINE_TYPE_STORAGE_KEY = 'interactivity-graph-engine-type';

export const App = () => {
  const [engineType, setEngineType] = useState<EngineType>(EngineType.BABYLON);
  const [modelUrl, setModelUrl] = useState<string | null>(null);

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
        case 'three':
          setEngineType(EngineType.THREE);
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
  }, []);

  // Save engine type when it changes
  const handleEngineTypeChange = (type: EngineType) => {
    setEngineType(type);
    localStorage.setItem(ENGINE_TYPE_STORAGE_KEY, type);
  };

  return (
    <InteractivityGraphProvider>
        <div style={{width: "100vw", height: "100vh"}}>
 
        <AuthoringComponent/>
    
        <EngineSelector setEngineType={handleEngineTypeChange} currentEngineType={engineType}/>

        <Spacer width={0} height={32}/>

        <RenderIf shouldShow={engineType === EngineType.LOGGING}>
             <LoggingEngineComponent modelUrl={modelUrl} />
        </RenderIf>
        <RenderIf shouldShow={engineType === EngineType.BABYLON}>
            <BabylonEngineComponent modelUrl={modelUrl} />
        </RenderIf>
        <RenderIf shouldShow={engineType === EngineType.THREE}>
            <ThreeEngineComponent modelUrl={modelUrl} />
        </RenderIf>
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
                default:
                    throw Error("Invalid Selection")
            }
            setActiveKey(key);
            setEngineType(engine);
        }
    };

    return (
        <div style={{width: "90vw", margin: "0 auto", textAlign: "center", marginTop: 32}}>
            <h2>glTF Interactivity Runtime</h2>
            <div data-testid={"engine-selector"}>
                <Tabs
                    activeKey={activeKey}
                    onSelect={handleEngineChange}
                >
                    <Tab title={"Logging Engine"} eventKey={1}/>
                    <Tab title={"Babylon Engine"} eventKey={2}/>
                    <Tab title={"Three.js Engine"} eventKey={3}/>
                </Tabs>
            </div>
            
        </div>

    );
}
