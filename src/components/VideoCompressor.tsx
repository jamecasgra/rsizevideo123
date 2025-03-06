import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileVideo, AlertCircle, Share2, RefreshCw, Download, Clock, Mail, Check } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ProcessResponse {
  folderId: string;
  filename: string;
  originalSize: number;
  newSize?: number;
  estimatedNewSize?: number;
  reductionPercentage?: number;
  estimatedReductionPercentage?: number;
  expiresAt: string;
  compressionTime?: number;
  emailNotification?: boolean;
  email?: string;
}

interface StoredVideo {
  folderId: string;
  filename: string;
  originalSize: number;
  newSize?: number;
  estimatedNewSize?: number;
  reductionPercentage?: number;
  estimatedReductionPercentage?: number;
  expiresAt: string;
  compressionTime?: number;
  storedAt: number;
  emailNotification?: boolean;
  email?: string;
}

// Update API URLs to use absolute paths for development
const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? `http://${window.location.hostname}:5000` 
  : '';

const API_DOWNLOAD_BASE_URL = process.env.NODE_ENV === 'development' 
  ? `http://${window.location.hostname}:5001` 
  : '';

const API_URLS = {
  PROCESS: `${API_BASE_URL}/process-video`,
  DOWNLOAD: `${API_DOWNLOAD_BASE_URL}/download-video`,
};

// API key for authentication
const API_KEY = 'wetrbctyrt23r672429346b8cw9b8erywueyr7123647326489bc18yw89eucr9b1287346bc1ywuerbqwyueirybcqy98r761b237489656231892erbcw89biuo12u3468sdgn01298nc8n1ndi2n8u1nw9dn3717nspskfnw9731n0237461928ubc762yuebcqiwub127934'; // This should match the API_KEY in your .env file

const STORAGE_KEY = 'compressed_videos';
const EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 24 hours

const VideoCompressor = () => {
  const [file, setFile] = useState<File | null>(null);
  const [targetSize, setTargetSize] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processedVideo, setProcessedVideo] = useState<StoredVideo | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [storedVideos, setStoredVideos] = useState<StoredVideo[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  // Load stored videos from localStorage
  useEffect(() => {
    const loadStoredVideos = () => {
      const storedData = localStorage.getItem(STORAGE_KEY);
      if (storedData) {
        try {
          const videos = JSON.parse(storedData) as StoredVideo[];
          // Filter out expired videos
          const now = Date.now();
          const validVideos = videos.filter(video => {
            const expiresAt = new Date(video.expiresAt).getTime();
            return expiresAt > now;
          });
          
          setStoredVideos(validVideos);
          
          // Clean up expired videos
          if (validVideos.length !== videos.length) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(validVideos));
          }
        } catch (err) {
          console.error('Error parsing stored videos:', err);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    };
    
    loadStoredVideos();
    
    // Set up interval to check for expired videos
    const interval = setInterval(loadStoredVideos, 60 * 1000); // Check every minute
    
    return () => clearInterval(interval);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.type.startsWith('video/')) {
        setError('Please select a valid video file');
        return;
      }
      setFile(selectedFile);
      setError(null);
      setDebugInfo(null);
      setShowResults(false);
      
      // Set initial target size to 50% of original size
      const fileSizeMB = selectedFile.size / (1024 * 1024);
      setTargetSize(Math.floor(fileSizeMB * 0.5));
    }
  };

  const storeVideo = (video: ProcessResponse) => {
    const storedVideo: StoredVideo = {
      ...video,
      storedAt: Date.now()
    };
    
    const updatedVideos = [...storedVideos, storedVideo];
    setStoredVideos(updatedVideos);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedVideos));
    
    return storedVideo;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a video file');
      return;
    }

    if (!termsAccepted) {
      setError('You must accept the Terms of Service and Privacy Policy');
      return;
    }

    const fileSizeMB = file.size / (1024 * 1024);
    if (targetSize >= fileSizeMB) {
      setError(`Target size must be smaller than the original file size (${fileSizeMB.toFixed(2)} MB)`);
      return;
    }

    setError(null);
    setDebugInfo(null);
    setIsUploading(true);
    setUploadProgress(0);
    setIsCompressing(false);

    // Show email modal after upload starts
    setShowEmailModal(true);
  };

  const processVideo = async (useEmail: boolean) => {
    if (!file) return;
    
    setShowEmailModal(false);
    
    const formData = new FormData();
    formData.append('video', file);
    formData.append('targetSize', targetSize.toString());
    
    if (useEmail && email) {
      formData.append('email', email);
      setEmailSent(true);
    }

    try {
      setDebugInfo(`Sending request to: ${API_URLS.PROCESS}`);
      
      // Create XMLHttpRequest to track upload progress
      const xhr = new XMLHttpRequest();
      
      // Set up progress tracking
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
          
          if (progress === 100) {
            setIsUploading(false);
            setIsCompressing(true);
          }
        }
      });
      
      // Create a promise to handle the XHR response
      const xhrPromise = new Promise<ProcessResponse>((resolve, reject) => {
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
              } catch (e) {
                reject(new Error(`Invalid response format: ${xhr.responseText.substring(0, 100)}...`));
              }
            } else {
              let errorMessage = `HTTP Error: ${xhr.status}`;
              try {
                const errorResponse = JSON.parse(xhr.responseText);
                if (errorResponse.error) {
                  errorMessage = errorResponse.error;
                }
              } catch (e) {
                // If not JSON, use status text
                if (xhr.statusText) {
                  errorMessage = `${errorMessage} - ${xhr.statusText}`;
                }
              }
              reject(new Error(errorMessage));
            }
          }
        };
      });
      
      // Open and send the request
      xhr.open('POST', API_URLS.PROCESS, true);
      xhr.setRequestHeader('Authorization', `Bearer ${API_KEY}`);
      xhr.send(formData);
      
      // Wait for the response
      const responseData = await xhrPromise;
      
      // Store the processed video
      const storedVideo = storeVideo(responseData);
      setProcessedVideo(storedVideo);
      setShowResults(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(`Error: ${errorMessage}. Please try again.`);
      console.error('Processing error:', err);
    } finally {
      setIsUploading(false);
      setIsCompressing(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleShare = async () => {
    if (processedVideo) {
      const downloadUrl = `${window.location.origin}${API_URLS.DOWNLOAD}/${processedVideo.folderId}/${processedVideo.filename}`;
      try {
        await navigator.clipboard.writeText(downloadUrl);
        alert('Download link copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy link:', err);
      }
    }
  };

  const getDownloadUrl = (video: StoredVideo) => {
    return `${API_URLS.DOWNLOAD}/${video.folderId}/${video.filename}`;
  };

  const closeEmailModal = () => {
    setShowEmailModal(false);
    processVideo(false);
  };

  const submitEmail = () => {
    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }
    processVideo(true);
  };

  return (
    <div className="py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Video Size Reducer</h1>
          <p className="text-gray-400 text-lg">Reduce your video size while maintaining quality</p>
        </div>

        {emailSent ? (
          <div className="bg-[#242938] rounded-lg shadow-xl p-8 text-center">
            <div className="flex flex-col items-center justify-center">
              <div className="bg-green-500 rounded-full p-3 mb-4">
                <Mail className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-4">Email Notification Sent!</h2>
              <p className="text-gray-300 mb-6">
                We'll send you an email at <span className="text-blue-400">{email}</span> when your video is ready.
                You can safely close this page now.
              </p>
              <p className="text-gray-400 text-sm">
                The compressed video will be available for download for 24 hours.
              </p>
            </div>
          </div>
        ) : !showResults ? (
          <div className="bg-[#242938] rounded-lg shadow-xl p-6 md:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div 
                className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="video/*"
                  className="hidden"
                />
                <div className="flex flex-col items-center">
                  {file ? (
                    <FileVideo className="w-16 h-16 text-blue-500 mb-4" />
                  ) : (
                    <Upload className="w-16 h-16 text-gray-400 mb-4" />
                  )}
                  <p className="text-lg text-gray-300 mb-2">
                    {file ? file.name : 'Drag your video here or click to select'}
                  </p>
                  <p className="text-sm text-gray-500">
                    Compatible with all major video formats
                  </p>
                  {file && (
                    <p className="text-sm text-blue-400 mt-2">
                      Size: {formatFileSize(file.size)}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="targetSize" className="block text-sm font-medium text-gray-300 mb-2">
                  Target Size (MB)
                </label>
                <input
                  type="number"
                  id="targetSize"
                  value={targetSize}
                  onChange={(e) => setTargetSize(Math.max(0, Number(e.target.value)))}
                  className="block w-full bg-[#1a1f2e] text-white rounded-md border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  min="0"
                  step="0.1"
                />
              </div>

              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="terms"
                    name="terms"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-600 rounded"
                  />
                </div>
                <div className="ml-3 text-sm">
                  <label htmlFor="terms" className="text-gray-300">
                    I accept the <Link to="/terms" className="text-blue-400 hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-blue-400 hover:underline">Privacy Policy</Link>
                  </label>
                </div>
              </div>

              {error && (
                <div className="bg-red-900/50 border-l-4 border-red-500 p-4 rounded">
                  <div className="flex">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <p className="ml-3 text-sm text-red-300">{error}</p>
                  </div>
                </div>
              )}

              {debugInfo && (
                <div className="bg-blue-900/50 border-l-4 border-blue-500 p-4 rounded">
                  <p className="text-sm text-blue-300">{debugInfo}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={!file || isUploading || isCompressing || !termsAccepted}
                className={`w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                  (!file || isUploading || isCompressing || !termsAccepted) && 'opacity-50 cursor-not-allowed'
                }`}
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="animate-spin -ml-1 mr-3 h-5 w-5" />
                    Uploading {uploadProgress}%
                  </>
                ) : isCompressing ? (
                  <>
                    <RefreshCw className="animate-spin -ml-1 mr-3 h-5 w-5" />
                    Compressing...
                  </>
                ) : (
                  'Process Video'
                )}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-[#242938] rounded-lg shadow-xl p-6 md:p-8">
            <div className="text-center mb-8">
              <div className="relative inline-block">
                <svg className="w-32 h-32" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2"
                    strokeDasharray={`${processedVideo?.reductionPercentage || processedVideo?.estimatedReductionPercentage || 0}, 100`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">
                    {processedVideo?.reductionPercentage || processedVideo?.estimatedReductionPercentage || 0}%
                  </span>
                </div>
              </div>
              <p className="text-blue-400 mt-2">Size Reduced</p>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-[#1a1f2e] p-4 rounded-lg">
                <p className="text-gray-400 text-sm">Original Size</p>
                <p className="text-white text-lg font-semibold">
                  {formatFileSize(processedVideo?.originalSize || 0)}
                </p>
              </div>
              <div className="bg-[#1a1f2e] p-4 rounded-lg">
                <p className="text-gray-400 text-sm">New Size</p>
                <p className="text-white text-lg font-semibold">
                  {formatFileSize(processedVideo?.newSize || processedVideo?.estimatedNewSize || 0)}
                </p>
              </div>
              {processedVideo?.compressionTime && (
                <div className="bg-[#1a1f2e] p-4 rounded-lg">
                  <p className="text-gray-400 text-sm">Processing Time</p>
                  <p className="text-white text-lg font-semibold">
                    {formatTime(processedVideo.compressionTime)}
                  </p>
                </div>
              )}
              <div className="bg-[#1a1f2e] p-4 rounded-lg">
                <p className="text-gray-400 text-sm">Expires At</p>
                <p className="text-white text-lg font-semibold">
                  {new Date(processedVideo?.expiresAt || '').toLocaleString()}
                </p>
              </div>
            </div>

            {processedVideo?.emailNotification ? (
              <div className="bg-[#1a1f2e] p-4 rounded-lg mb-6">
                <div className="flex items-center">
                  <Mail className="w-5 h-5 text-blue-400 mr-2" />
                  <p className="text-white">
                    Email notification will be sent to <span className="text-blue-400">{processedVideo.email}</span> when processing is complete.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <a
                  href={processedVideo ? getDownloadUrl(processedVideo) : '#'}
                  className="w-full flex justify-center items-center py-3 px-4 rounded-md text-lg font-medium text-white bg-green-600 hover:bg-green-700 transition-colors"
                  download
                >
                  <Download className="mr-2 h-5 w-5" />
                  Download Compressed Video
                </a>
                
                <button
                  onClick={handleShare}
                  className="w-full flex justify-center items-center py-3 px-4 rounded-md text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  <Share2 className="mr-2 h-5 w-5" />
                  Share Download Link
                </button>
              </div>
            )}

            <button
              onClick={() => {
                setFile(null);
                setShowResults(false);
                setProcessedVideo(null);
                setEmailSent(false);
              }}
              className="w-full flex justify-center items-center py-3 px-4 mt-4 rounded-md text-lg font-medium text-white bg-gray-600 hover:bg-gray-700 transition-colors"
            >
              Compress Another Video
            </button>
          </div>
        )}

        {storedVideos.length > 0 && !showResults && !emailSent && (
          <div className="mt-8 bg-[#242938] rounded-lg shadow-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Recent Compressions</h2>
            <div className="space-y-4">
              {storedVideos.slice(0, 3).map((video, index) => (
                <div key={index} className="bg-[#1a1f2e] p-4 rounded-lg flex justify-between items-center">
                  <div>
                    <p className="text-white font-medium">{video.filename}</p>
                    <div className="flex items-center text-sm text-gray-400 mt-1">
                      <Clock className="w-4 h-4 mr-1" />
                      <span>Expires: {new Date(video.expiresAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <a
                      href={getDownloadUrl(video)}
                      className="p-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                      download
                    >
                      <Download className="w-5 h-5" />
                    </a>
                    <button
                      onClick={() => {
                        setProcessedVideo(video);
                        setShowResults(true);
                      }}
                      className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      <Share2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Email Modal */}
        {showEmailModal && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-[#242938] rounded-lg shadow-xl p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-white mb-4">Get Email Notification</h2>
              <p className="text-gray-300 mb-4">
                Would you like to receive an email when your video is compressed? This way you can close the browser and we'll notify you when it's ready.
              </p>
              
              <div className="mb-4">
                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="block w-full bg-[#1a1f2e] text-white rounded-md border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2"
                />
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={submitEmail}
                  className="flex-1 flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Notify Me
                </button>
                <button
                  onClick={closeEmailModal}
                  className="flex-1 flex justify-center items-center py-2 px-4 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-300 bg-transparent hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  No Thanks
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCompressor;