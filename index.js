/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, Fragment } from 'preact';
import { html } from 'htm/preact';
import { useState, useCallback, useMemo, useEffect, useRef } from 'preact/hooks';
import { GoogleGenAI, Type } from "@google/genai";

// JSZip is loaded globally from the CDN in index.html

const translations = {
  en: {
    title: "AI Resume Analyzer",
    uploadHeader: "1. Upload Resumes",
    dropzoneText: "Drag & drop files here or click to select",
    supportedFormats: "(PDF, Word, Excel, ZIP)",
    analyzingStatus: (processed, total) => `Analyzing ${processed}/${total}...`,
    analysisComplete: (uniqueCount, duplicateCount) => `Analyzed ${uniqueCount} unique resumes (${duplicateCount} duplicates removed).`,
    prepareFiles: "Preparing files...",
    matchHeader: "2. Match Job Description",
    jobDescriptionPlaceholder: "Paste the job description here...",
    matchButton: "Find Best Candidates",
    matchError: "Please enter a job description and ensure resumes are analyzed.",
    matchingStatus: (processed, total) => `Matching ${processed}/${total} candidates...`,
    matchComplete: "Matching process completed!",
    resultsHeader: (count) => `Analysis Results (${count})`,
    filterJobPlaceholder: "Filter by Job...",
    filterGovernoratePlaceholder: "Filter by Governorate...",
    filterAgePlaceholder: "Age (e.g., 25-30)",
    placeholderText: "Resume analysis results will appear here.",
    age: "Age",
    governorate: "Governorate",
    appliedFor: "Applied For",
    email: "Email",
    phone: "Phone",
    skills: "Skills",
    unspecified: "Unspecified",
    matchScore: (score) => `Match ${score}%`,
    analysisPrompt: 'Analyze this resume and extract the following information. Respond in English.',
    analysisError: (fileName) => `An error occurred while analyzing: ${fileName}`,
    viewCV: "View CV",
    apiKeyError: "AI Service could not be initialized. Please ensure the API key is configured correctly in the environment.",
    footerText: "Made by Fahmy Mohsen",
  },
  ar: {
    title: "محلل السير الذاتية",
    uploadHeader: "١. رفع السير الذاتية",
    dropzoneText: "اسحب وأفلت الملفات هنا أو انقر للاختيار",
    supportedFormats: "(PDF, Word, Excel, ZIP)",
    analyzingStatus: (processed, total) => `جاري تحليل ${processed}/${total} سيرة ذاتية...`,
    analysisComplete: (uniqueCount, duplicateCount) => `تم تحليل ${uniqueCount} سيرة ذاتية فريدة (تمت إزالة ${duplicateCount} نسخة مكررة).`,
    prepareFiles: "جاري تحضير الملفات...",
    matchHeader: "٢. مطابقة الوظائف",
    jobDescriptionPlaceholder: "الصق الوصف الوظيفي هنا...",
    matchButton: "إيجاد أفضل المرشحين",
    matchError: "يرجى كتابة وصف وظيفي والتأكد من وجود سير ذاتية تم تحليلها.",
    matchingStatus: (processed, total) => `جاري مطابقة ${processed}/${total} مرشح...`,
    matchComplete: "اكتملت عملية المطابقة!",
    resultsHeader: (count) => `نتائج التحليل (${count})`,
    filterJobPlaceholder: "تصفية بالوظيفة...",
    filterGovernoratePlaceholder: "تصفية بالمحافظة...",
    filterAgePlaceholder: "العمر (مثال: 25-30)",
    placeholderText: "ستظهر نتائج تحليل السير الذاتية هنا.",
    age: "العمر",
    governorate: "المحافظة",
    appliedFor: "الوظيفة المتقدم لها",
    email: "البريد الإلكتروني",
    phone: "الهاتف",
    skills: "المهارات",
    unspecified: "غير محدد",
    matchScore: (score) => `مطابقة ${score}%`,
    analysisPrompt: 'حلل هذه السيرة الذاتية واستخرج المعلومات التالية. أجب باللغة العربية.',
    analysisError: (fileName) => `حدث خطأ أثناء تحليل الملف: ${fileName}`,
    viewCV: "عرض السيرة الذاتية",
    apiKeyError: "تعذر تهيئة خدمة الذكاء الاصطناعي. يرجى التأكد من تكوين مفتاح الواجهة البرمجية بشكل صحيح في البيئة.",
    footerText: "صنع بواسطة Fahmy Mohsen",
  }
};

let ai = null;
try {
  // The API key is expected to be in process.env.API_KEY
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} catch (e) {
  console.error("Failed to initialize GoogleGenAI. API key might be missing.", e);
}


/**
 * A wrapper for the Gemini API call that includes retry logic with exponential backoff.
 * This makes the application more resilient to 429 rate limit errors.
 */
const generateContentWithRetry = async (ai, params, retries = 4, initialDelay = 2000) => {
    let attempt = 0;
    let delay = initialDelay;
    while (attempt < retries) {
        try {
            return await ai.models.generateContent(params);
        } catch (e) {
            attempt++;
            const isRateLimitError = e instanceof Error && (e.message.includes('429') || e.message.toLowerCase().includes('resource_exhausted'));
            
            if (isRateLimitError && attempt < retries) {
                const jitter = Math.random() * 1000;
                console.warn(`Rate limit hit. Retrying in ${(delay + jitter) / 1000}s... (Attempt ${attempt})`);
                await new Promise(resolve => setTimeout(resolve, delay + jitter));
                delay *= 2; // Exponential backoff
            } else {
                console.error("Final attempt failed or non-retriable error:", e);
                throw e;
            }
        }
    }
    throw new Error("API call failed after multiple retries.");
};

const App = () => {
  const [resumes, setResumes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [filters, setFilters] = useState({ job: '', governorate: '', age: '' });
  const [isDragging, setIsDragging] = useState(false);
  const [lang, setLang] = useState('en');
  const blobUrlsRef = useRef([]);

  const T = useMemo(() => translations[lang], [lang]);
  
  // On unmount, clean up any created blob URLs to prevent memory leaks.
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(URL.revokeObjectURL);
    }
  }, []);

  // Set an error message if the AI client failed to initialize on load.
  useEffect(() => {
      if (!ai) {
          setError(T.apiKeyError);
      }
  }, [T]);


  const resumeSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Candidate\'s full name' },
        age: { type: Type.NUMBER, description: 'Candidate\'s age' },
        governorate: { type: Type.STRING, description: 'The governorate or city where the candidate resides' },
        email: { type: Type.STRING, description: 'Candidate\'s email address' },
        phone: { type: Type.STRING, description: 'Candidate\'s phone number' },
        appliedFor: { type: Type.STRING, description: 'The job position applied for, if mentioned' },
        skills: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'A list of the candidate\'s key technical and soft skills'
        },
        experienceSummary: {
          type: Type.STRING,
          description: 'A brief 2-3 sentence summary of the candidate\'s professional experience'
        },
      },
      required: ['name', 'skills', 'experienceSummary']
  };
    
  const fileToGenerativePart = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        const base64Data = dataUrl.split(',')[1];
        resolve({
          inlineData: {
            mimeType: file.type,
            data: base64Data
          }
        });
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const analyzeResume = async (file) => {
    try {
      const part = await fileToGenerativePart(file);
      const result = await generateContentWithRetry(ai, {
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                part,
                { text: T.analysisPrompt }
            ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: resumeSchema,
        }
      });
      const parsedData = JSON.parse(result.text);
      return { ...parsedData, id: file.name + Date.now(), matchScore: null };
    } catch (e) {
      console.error(`Error analyzing ${file.name}:`, e);
      let errorMessage = T.analysisError(file.name);
      if (e instanceof Error && e.message.includes('429')) {
          errorMessage += ' (API rate limit exceeded. The process was stopped.)';
      }
      setError(errorMessage);
      return null;
    }
  };
    
  const handleFileDrop = useCallback(async (files) => {
    if (!ai) {
        setError(T.apiKeyError);
        return;
    }
    setIsLoading(true);
    setError('');
    setStatusMessage(T.prepareFiles);

    // Clean up URLs from previous session
    blobUrlsRef.current.forEach(URL.revokeObjectURL);
    blobUrlsRef.current = [];
    setResumes([]);
    
    let allFiles = [];
    const supportedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];

    for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
            const zip = await JSZip.loadAsync(file);
            for (const filename in zip.files) {
                if (!zip.files[filename].dir && supportedExtensions.some(ext => filename.toLowerCase().endsWith(ext))) {
                    const blob = await zip.files[filename].async('blob');
                    const newFile = new File([blob], filename);
                    allFiles.push(newFile);
                }
            }
        } else if (supportedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
            allFiles.push(file);
        }
    }
    
    let analyzedResumesCount = 0;
    const uniqueIdentifiers = new Set();
    
    for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        setStatusMessage(T.analyzingStatus(i + 1, allFiles.length));

        const analysisData = await analyzeResume(file);
        
        if (analysisData) {
            analyzedResumesCount++;
            const blobUrl = URL.createObjectURL(file);
            blobUrlsRef.current.push(blobUrl);
            const resumeWithUrl = { ...analysisData, fileURL: blobUrl, fileType: file.type, fileName: file.name };
            
            const identifier = `${(resumeWithUrl.name || '').toLowerCase()}|${(resumeWithUrl.email || '').toLowerCase()}`;
            if (!uniqueIdentifiers.has(identifier)) {
                uniqueIdentifiers.add(identifier);
                setResumes(prev => [...prev, resumeWithUrl]);
            }
        } else {
          // Stop processing if an error occurred to avoid cascading failures
          setIsLoading(false);
          return;
        }

        // Wait for 1 second between requests to avoid rate limiting
        if (i < allFiles.length - 1) {
             await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    const uniqueCount = uniqueIdentifiers.size;
    const duplicateCount = analyzedResumesCount - uniqueCount;

    setStatusMessage(T.analysisComplete(uniqueCount, duplicateCount));
    setIsLoading(false);
  }, [T]);
    
  const handleDragEvents = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'dragover') setIsDragging(true);
      if (e.type === 'dragleave' || e.type === 'drop') setIsDragging(false);
  };
    
  const onDrop = (e) => {
      handleDragEvents(e);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
          handleFileDrop(Array.from(files));
      }
  };

  const onFileChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileDrop(Array.from(files));
    }
  };

  const handleMatch = async () => {
    if (!ai) {
        setError(T.apiKeyError);
        return;
    }
    if (!jobDescription || resumes.length === 0) {
        setError(T.matchError);
        return;
    }
    setIsLoading(true);
    setError('');
    
    for (let i = 0; i < resumes.length; i++) {
        const resume = resumes[i];
        setStatusMessage(T.matchingStatus(i + 1, resumes.length));
        let matchScore = 0;
        try {
            const prompt = `
                Job Description: "${jobDescription}"
                
                Candidate Data:
                - Skills: ${resume.skills.join(', ')}
                - Experience Summary: ${resume.experienceSummary}

                Based on the above, what is the match percentage for this candidate for the job, from 0 to 100?
                Provide the answer as JSON only, in the following format: {"matchScore": number}
            `;
            const result = await generateContentWithRetry(ai, {
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            matchScore: { type: Type.NUMBER }
                        }
                    }
                }
            });
            matchScore = JSON.parse(result.text).matchScore;
        } catch (e) {
            console.error('Error matching resume:', e);
            let errorMessage = `Error matching candidate: ${resume.name}.`;
             if (e instanceof Error && e.message.includes('429')) {
                errorMessage += ' (API rate limit exceeded. The process was stopped.)';
             }
            setError(errorMessage);
            setIsLoading(false);
            return;
        }

        setResumes(currentResumes => {
            const updated = currentResumes.map(r => 
                r.id === resume.id ? { ...r, matchScore } : r
            );
            return updated.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
        });

        // Wait for 1 second between requests to avoid rate limiting
        if (i < resumes.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    setIsLoading(false);
    setStatusMessage(T.matchComplete);
  };

  const switchLanguage = (newLang) => {
    setLang(newLang);
    document.documentElement.lang = newLang;
    document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr';
  };

  const filteredResumes = useMemo(() => {
    return resumes.filter(r => {
        const jobMatch = !filters.job || (r.appliedFor && r.appliedFor.toLowerCase().includes(filters.job.toLowerCase()));
        const govMatch = !filters.governorate || (r.governorate && r.governorate.toLowerCase().includes(filters.governorate.toLowerCase()));
        
        const ageFilter = String(filters.age || '').trim();
        if (!ageFilter || r.age === null || r.age === undefined) {
            return jobMatch && govMatch && !ageFilter;
        }

        let ageMatch = true;
        if (ageFilter.includes('-')) {
            const [minStr, maxStr] = ageFilter.split('-');
            const minAge = parseInt(minStr, 10);
            const maxAge = parseInt(maxStr, 10);
            const isMinValid = !isNaN(minAge), isMaxValid = !isNaN(maxAge);
            if (isMinValid && isMaxValid) ageMatch = r.age >= minAge && r.age <= maxAge;
            else if (isMinValid) ageMatch = r.age >= minAge;
            else if (isMaxValid) ageMatch = r.age <= maxAge;
        } else {
            const exactAge = parseInt(ageFilter, 10);
            if (!isNaN(exactAge)) ageMatch = r.age === exactAge;
        }
        
        return jobMatch && govMatch && ageMatch;
    });
  }, [resumes, filters]);

  const formatPhoneForWhatsApp = (phone) => {
    if (!phone) return '';
    let digitsOnly = phone.toString().replace(/\D/g, '');

    // Already has Egyptian country code (e.g., from +20, 0020)
    if (digitsOnly.startsWith('20')) {
      return digitsOnly;
    }

    // Standard Egyptian mobile number (e.g., 010..., 011...)
    if (digitsOnly.startsWith('01') && digitsOnly.length === 11) {
      return '20' + digitsOnly.substring(1); // Prepend 20 and remove the leading 0
    }
    
    // If it's a mobile number without the leading 0 (e.g., 10..., 11...)
    if (digitsOnly.startsWith('1') && digitsOnly.length === 10) {
        return '20' + digitsOnly;
    }

    // Fallback for other numbers, return as is (cleaned)
    return digitsOnly;
  };

  return html`
    <${Fragment}>
      <main class="main-container">
        <div class="control-panel">
          <div class="lang-switcher">
              <button class=${lang === 'en' ? 'active' : ''} onClick=${() => switchLanguage('en')}>EN</button>
              <button class=${lang === 'ar' ? 'active' : ''} onClick=${() => switchLanguage('ar')}>AR</button>
          </div>
          <h1>${T.title}</h1>
          
          <div class="control-section">
              <h3>${T.uploadHeader}</h3>
              <div 
                  class=${`dropzone ${isDragging ? 'drag-over' : ''}`}
                  onDragOver=${handleDragEvents}
                  onDragLeave=${handleDragEvents}
                  onDrop=${onDrop}
                  onClick=${() => document.getElementById('file-input')?.click()}
              >
                  <input type="file" id="file-input" multiple hidden onChange=${onFileChange} accept=".pdf,.doc,.docx,.xls,.xlsx,.zip" />
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l-3.75 3.75M12 9.75l3.75 3.75M3 17.25V8.25c0-1.12 0.93-2.02 2.08-1.95 1.15 0.07 2.08 1.02 2.08 2.15v9c0 1.13-0.93 2.02-2.08 1.95-1.15-0.07-2.08-1.02-2.08-2.15zM19.92 8.05c-1.15-0.07-2.08-1.02-2.08-2.15v-1.5c0-1.13 0.93-2.02 2.08-1.95 1.15 0.07 2.08 1.02 2.08 2.15v1.5c0 1.13-0.93 2.02-2.08 1.95z" /></svg>
                  <p>${T.dropzoneText}</p>
                  <small>${T.supportedFormats}</small>
              </div>
               <div class="status-message">
                  ${isLoading ? html`<div class="loader"></div>` : ''}
                  <p>${statusMessage}</p>
              </div>
          </div>

          <div class="control-section">
              <h3>${T.matchHeader}</h3>
              <textarea 
                  placeholder=${T.jobDescriptionPlaceholder}
                  value=${jobDescription}
                  onInput=${e => setJobDescription(e.currentTarget.value)}
                  disabled=${isLoading || !ai}
              ></textarea>
              <button onClick=${handleMatch} disabled=${isLoading || resumes.length === 0 || !ai}>
                  ${T.matchButton}
              </button>
          </div>
          ${error && html`<div class="error-message">${error}</div>`}
        </div>

        <div class="results-panel">
          ${resumes.length > 0 ? html`
              <div class="results-header">
                  <h2>${T.resultsHeader(filteredResumes.length)}</h2>
              </div>
              <div class="filter-controls">
                  <input type="text" placeholder=${T.filterJobPlaceholder} value=${filters.job} onInput=${e => setFilters({...filters, job: e.currentTarget.value})} />
                  <input type="text" placeholder=${T.filterGovernoratePlaceholder} value=${filters.governorate} onInput=${e => setFilters({...filters, governorate: e.currentTarget.value})} />
                  <input type="text" placeholder=${T.filterAgePlaceholder} value=${filters.age} onInput=${e => setFilters({...filters, age: e.currentTarget.value})} />
              </div>
              <div class="resume-list">
                  ${filteredResumes.map(resume => html`
                      <div class="resume-card" key=${resume.id}>
                          <div class="card-header">
                              <div class="card-title-group">
                                  <h4>${resume.name || T.unspecified}</h4>
                                  <a href=${resume.fileURL} target="_blank" rel="noopener noreferrer" class="view-cv-btn">${T.viewCV}</a>
                              </div>
                              ${resume.matchScore !== null && html`<div class="match-score">${T.matchScore(resume.matchScore)}</div>`}
                          </div>
                          <div class="card-body">
                             <p><strong>${T.age}:</strong> ${resume.age || T.unspecified}</p>
                             <p><strong>${T.governorate}:</strong> ${resume.governorate || T.unspecified}</p>
                             <p><strong>${T.appliedFor}:</strong> ${resume.appliedFor || T.unspecified}</p>
                             <p><strong>${T.email}:</strong> ${resume.email ? html`
                                 <a class="contact-link" href=${'mailto:' + resume.email}>
                                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                         <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.758 2.855L15 11.114V5.383zM1 4.217V12h14V4.217l-7 4.2-7-4.2z"/>
                                     </svg>
                                     <span>${resume.email}</span>
                                 </a>` : T.unspecified}</p>
                             <p><strong>${T.phone}:</strong> ${resume.phone ? html`
                                  <a class="contact-link" href=${'https://wa.me/' + formatPhoneForWhatsApp(resume.phone)} target="_blank" rel="noopener noreferrer">
                                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                          <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z"/>
                                     </svg>
                                     <span>${resume.phone}</span>
                                 </a>` : T.unspecified}</p>
                             <p>${resume.experienceSummary}</p>
                             <div class="skills-container">
                                  <strong>${T.skills}:</strong>
                                  <ul class="skills-list">
                                      ${resume.skills?.map(skill => html`<li class="skill-tag">${skill}</li>`)}
                                  </ul>
                             </div>
                          </div>
                      </div>
                  `)}
              </div>
          ` : html`
              <div class="placeholder">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m9.375 2.25c.621 0 1.125.504 1.125 1.125v3.375c0 .621-.504 1.125-1.125 1.125h-1.5a1.125 1.125 0 01-1.125-1.125v-3.375c0-.621.504-1.125 1.125-1.125h1.5z" /></svg>
                  <p>${T.placeholderText}</p>
              </div>
          `}
        </div>
      </main>
      <footer class="app-footer">
        <p>${T.footerText}</p>
      </footer>
    <//>
  `;
};

render(html`<${App} />`, document.getElementById('root'));
