import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { StepsList } from "../components/StepsList";
import { FileExplorer } from "../components/FileExplorer";
import { TabView } from "../components/TabView";
import { CodeEditor } from "../components/CodeEditor";
import { PreviewFrame } from "../components/PreviewFrame";
import { Step, FileItem, StepType } from "../types";
import axios from "axios";
import { BACKEND_URL } from "../config";
import { parseXml } from "../steps";
import { useWebContainer } from "../hooks/useWebContainer";
import { Loader } from "../components/Loader";

export function Builder() {
  const location = useLocation();
  const { prompt } = location.state as { prompt: string };
  const [userPrompt, setPrompt] = useState("");
  const [llmMessages, setLlmMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [templateSet, setTemplateSet] = useState(false);
  const webcontainer = useWebContainer();

  const [currentStep, setCurrentStep] = useState(1);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);

  const updateFiles = () => {
    const originalFiles = [...files];
    const pendingSteps = steps.filter(({ status }) => status === "pending");
    
    if (pendingSteps.length === 0) return;

    pendingSteps.forEach((step) => {
      if (step?.type === StepType.CreateFile && step.path) {
        const pathParts = step.path.split("/");
        let currentStructure = originalFiles;
        let currentPath = "";

        pathParts.forEach((part, index) => {
          currentPath = `${currentPath}/${part}`;
          const isLastPart = index === pathParts.length - 1;

          if (isLastPart) {
            const existingFile = currentStructure.find(x => x.path === currentPath);
            if (existingFile) {
              existingFile.content = step.code;
            } else {
              currentStructure.push({
                name: part,
                type: "file",
                path: currentPath,
                content: step.code,
              });
            }
          } else {
            let folder = currentStructure.find(x => x.path === currentPath);
            if (!folder) {
              folder = {
                name: part,
                type: "folder",
                path: currentPath,
                children: [],
              };
              currentStructure.push(folder);
            }
            currentStructure = folder.children!;
          }
        });
      }
    });

    setFiles(originalFiles);
    setSteps(prevSteps => 
      prevSteps.map(s => ({ ...s, status: "completed" as const }))
    );
  };

  const createMountStructure = (files: FileItem[]) => {
    const mountStructure: Record<string, any> = {};

    const processFile = (file: FileItem, isRoot: boolean) => {
      if (file.type === "folder") {
        const result = {
          directory: file.children 
            ? Object.fromEntries(
                file.children.map(child => [child.name, processFile(child, false)])
              )
            : {},
        };
        if (isRoot) mountStructure[file.name] = result;
        return result;
      } else {
        const result = {
          file: { contents: file.content || "" },
        };
        if (isRoot) mountStructure[file.name] = result;
        return result;
      }
    };

    files.forEach(file => processFile(file, true));
    return mountStructure;
  };

  const sendMessage = async () => {
    const newMessage = { role: "user" as const, content: userPrompt };
    setLoading(true);
    
    const response = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [...llmMessages, newMessage],
    });
    
    setLoading(false);
    setLlmMessages(prev => [...prev, newMessage, { role: "assistant", content: response.data.response }]);
    setSteps(prev => [...prev, ...parseXml(response.data.response).map(x => ({ ...x, status: "pending" as const }))]);
  };

  useEffect(() => {
    updateFiles();
  }, [steps]);

  useEffect(() => {
    if (webcontainer && files.length > 0) {
      const mountStructure = createMountStructure(files);
      webcontainer.mount(mountStructure);
    }
  }, [files, webcontainer]);

  useEffect(() => {
    const init = async () => {
      const response = await axios.post(`${BACKEND_URL}/template`, { prompt: prompt.trim() });
      setTemplateSet(true);

      const { prompts, uiPrompts } = response.data;
      setSteps(parseXml(uiPrompts[0]).map(x => ({ ...x, status: "pending" as const })));

      setLoading(true);
      const stepsResponse = await axios.post(`${BACKEND_URL}/chat`, {
        messages: [...prompts, prompt].map(content => ({ role: "user", content })),
      });
      setLoading(false);

      setSteps(prev => [...prev, ...parseXml(stepsResponse.data.response).map(x => ({ ...x, status: "pending" as const }))]);
      
      const messages = [...prompts, prompt].map(content => ({ role: "user" as const, content }));
      setLlmMessages([...messages, { role: "assistant", content: stepsResponse.data.response }]);
    };

    init();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3">
        <h1 className="text-2xl font-bold text-gray-100">Website Builder</h1>
        <p className="text-sm text-gray-400 mt-2">Prompt: {prompt}</p>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="h-full grid lg:grid-cols-4 grid-cols-1 gap-6 p-6">
          <div className="lg:col-span-1 col-span-4 space-y-6 flex flex-col">
            <div className="flex-grow max-h-[calc(100vh-15rem)] overflow-y-auto bg-gray-800 rounded-lg p-4 shadow-lg">
              <StepsList steps={steps} currentStep={currentStep} onStepClick={setCurrentStep} />
            </div>

            <div>
              {loading || !templateSet ? (
                <div className="flex items-center justify-center bg-gray-800 p-4 rounded-lg shadow-lg">
                  <Loader />
                  <p className="text-gray-300">The first request may take up to 30 seconds. Please wait...</p>
                </div>
              ) : (
                <div className="flex items-start bg-gray-800 p-4 rounded-lg shadow-lg">
                  <textarea
                    value={userPrompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="flex-grow p-3 rounded-md border border-gray-700 bg-gray-900 text-gray-300 focus:outline-none focus:ring focus:ring-purple-400"
                    placeholder="Type your message here..."
                  />
                  <button
                    onClick={sendMessage}
                    className="ml-3 px-4 py-2 bg-purple-600 text-white font-bold rounded-md hover:bg-purple-500 focus:outline-none focus:ring focus:ring-purple-400"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1 col-span-4 bg-gray-800 rounded-lg shadow-lg p-4 max-h-[calc(100vh-15rem)] overflow-y-auto">
            <FileExplorer files={files} onFileSelect={setSelectedFile} />
          </div>

          <div className="lg:col-span-2 col-span-4 bg-gray-900 rounded-lg shadow-lg p-4 h-[calc(100vh-15rem)]">
            <TabView activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="h-[calc(100%-4rem)] mt-4">
              {activeTab === "code" ? (
                <CodeEditor file={selectedFile} />
              ) : (
                <PreviewFrame webContainer={webcontainer!} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}