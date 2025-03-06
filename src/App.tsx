import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import VideoCompressor from './components/VideoCompressor';
import FAQ from './components/FAQ';
import PrivacyPolicy from './components/PrivacyPolicy';
import Terms from './components/Terms';
import Header from './components/Header';
import Footer from './components/Footer';

function App() {
  return (
    <Router>
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0f1219] to-[#1a1f2e]">
        <Header />
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<VideoCompressor />} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/download/:folderId/:filename" element={<VideoCompressor />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;