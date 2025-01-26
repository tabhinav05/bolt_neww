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
  const [llmMessages, setLlmMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [templateSet, setTemplateSet] = useState(false);
  const webcontainer = useWebContainer();

  const [currentStep, setCurrentStep] = useState(1);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  const [steps, setSteps] = useState<Step[]>([]);

  const [files, setFiles] = useState<FileItem[]>([]);

  console.log(webcontainer);

  useEffect(() => {
    let originalFiles = [...files];
    let updateHappened = false;
    steps
      .filter(({ status }) => status === "pending")
      .map((step) => {
        updateHappened = true;
        if (step?.type === StepType.CreateFile) {
          let parsedPath = step.path?.split("/") ?? []; // ["src", "components", "App.tsx"]
          let currentFileStructure = [...originalFiles]; // {}
          let finalAnswerRef = currentFileStructure;

          let currentFolder = "";
          while (parsedPath.length) {
            currentFolder = `${currentFolder}/${parsedPath[0]}`;
            let currentFolderName = parsedPath[0];
            parsedPath = parsedPath.slice(1);

            if (!parsedPath.length) {
              // final file
              let file = currentFileStructure.find(
                (x) => x.path === currentFolder
              );
              if (!file) {
                currentFileStructure.push({
                  name: currentFolderName,
                  type: "file",
                  path: currentFolder,
                  content: step.code,
                });
              } else {
                file.content = step.code;
              }
            } else {
              /// in a folder
              let folder = currentFileStructure.find(
                (x) => x.path === currentFolder
              );
              if (!folder) {
                // create the folder
                currentFileStructure.push({
                  name: currentFolderName,
                  type: "folder",
                  path: currentFolder,
                  children: [],
                });
              }

              currentFileStructure = currentFileStructure.find(
                (x) => x.path === currentFolder
              )!.children!;
            }
          }
          originalFiles = finalAnswerRef;
        }
      });

    if (updateHappened) {
      setFiles(originalFiles);
      setSteps((steps) =>
        steps.map((s: Step) => {
          return {
            ...s,
            status: "completed",
          };
        })
      );
    }
    console.log(files);
  }, [steps, files]);

  useEffect(() => {
    const createMountStructure = (files: FileItem[]): Record<string, any> => {
      const mountStructure: Record<string, any> = {};

      const processFile = (file: FileItem, isRootFolder: boolean) => {
        if (file.type === "folder") {
          // For folders, create a directory entry
          mountStructure[file.name] = {
            directory: file.children
              ? Object.fromEntries(
                  file.children.map((child) => [
                    child.name,
                    processFile(child, false),
                  ])
                )
              : {},
          };
        } else if (file.type === "file") {
          if (isRootFolder) {
            mountStructure[file.name] = {
              file: {
                contents: file.content || "",
              },
            };
          } else {
            // For files, create a file entry with contents
            return {
              file: {
                contents: file.content || "",
              },
            };
          }
        }

        return mountStructure[file.name];
      };

      // Process each top-level file/folder
      files.forEach((file) => processFile(file, true));

      return mountStructure;
    };

    const mountStructure = createMountStructure(files);

    // Mount the structure if WebContainer is available
    console.log(mountStructure);
    webcontainer?.mount(mountStructure);
  }, [files, webcontainer]);

  async function init() {
    const response = await axios.post(`${BACKEND_URL}/template`, {
      prompt: prompt.trim(),
    });
    setTemplateSet(true);

    const { prompts, uiPrompts } = response.data;

    setSteps(
      parseXml(uiPrompts[0]).map((x: Step) => ({
        ...x,
        status: "pending",
      }))
    );

    setLoading(true);
    const stepsResponse = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [...prompts, prompt].map((content) => ({
        role: "user",
        content,
      })),
    });

    setLoading(false);

    setSteps((s) => [
      ...s,
      ...parseXml(stepsResponse.data.response).map((x) => ({
        ...x,
        status: "pending" as "pending",
      })),
    ]);

    setLlmMessages(
      [...prompts, prompt].map((content) => ({
        role: "user",
        content,
      }))
    );

    setLlmMessages((x) => [
      ...x,
      { role: "assistant", content: stepsResponse.data.response },
    ]);
  }

  useEffect(() => {
    init();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
  {/* Header */}
  <header className="bg-gray-800 border-b border-gray-700 px-6 py-3">
    <h1 className="text-2xl font-bold text-gray-100">Website Builder</h1>
    <p className="text-sm text-gray-400 mt-2">Prompt: {prompt}</p>
  </header>

  {/* Main Content */}
  <div className="flex-1 overflow-hidden">
    <div className="h-full grid lg:grid-cols-4 grid-cols-1 gap-6 p-6">
      {/* Sidebar: Steps */}
      <div className="lg:col-span-1 col-span-4 space-y-6 flex flex-col">
        {/* Build Steps Section */}
        <div className="flex-grow max-h-[calc(100vh-15rem)] overflow-y-auto bg-gray-800 rounded-lg p-4 shadow-lg">
          <StepsList
            steps={steps}
            currentStep={currentStep}
            onStepClick={setCurrentStep}
          />
        </div>

        {/* Loader or Textarea/Send Button */}
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
              ></textarea>
              <button
                onClick={async () => {
                  const newMessage = {
                    role: "user" as "user",
                    content: userPrompt,
                  };

                  setLoading(true);
                  const stepsResponse = await axios.post(
                    `${BACKEND_URL}/chat`,
                    {
                      messages: [...llmMessages, newMessage],
                    }
                  );
                  setLoading(false);

                  setLlmMessages((x) => [...x, newMessage]);
                  setLlmMessages((x) => [
                    ...x,
                    {
                      role: "assistant",
                      content: stepsResponse.data.response,
                    },
                  ]);

                  setSteps((s) => [
                    ...s,
                    ...parseXml(stepsResponse.data.response).map((x) => ({
                      ...x,
                      status: "pending" as "pending",
                    })),
                  ]);
                }}
                className="ml-3 px-4 py-2 bg-purple-600 text-white font-bold rounded-md hover:bg-purple-500 focus:outline-none focus:ring focus:ring-purple-400"
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>

      {/* File Explorer */}
      <div className="lg:col-span-1 col-span-4 bg-gray-800 rounded-lg shadow-lg p-4 max-h-[calc(100vh-15rem)] overflow-y-auto">
        <FileExplorer files={files} onFileSelect={setSelectedFile} />
      </div>

      {/* Main Content: Editor/Preview */}
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
