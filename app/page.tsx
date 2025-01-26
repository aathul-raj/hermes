"use client"
import React, { useState } from 'react';

export default function Home() {
  const [toPhone, setToPhone] = useState('');
  const [greeting, setGreeting] = useState('Hello! This is Athul from ACME!');
  const [topic, setTopic] = useState('Discussing our new product launch');
  const [ending, setEnding] = useState('Thank you and have a great day!');
  const [questions, setQuestions] = useState(['Are you interested?', 'Any feedback for us?'].join('\n'));
  const [businessInfo, setBusinessInfo] = useState('ACME Inc, specialized in roadrunner devices.');

  const [callSid, setCallSid] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  const [isComplete, setIsComplete] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prepare the questions as an array
    const qsArray = questions.split('\n').map(q => q.trim()).filter(Boolean);

    const res = await fetch('/api/outbound-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toPhone,
        greeting,
        topic,
        ending,
        questions: qsArray,
        businessInfo
      }),
    });

    const data = await res.json();
    if (data.callSid) {
      setCallSid(data.callSid);
      alert(`Call initiated! SID: ${data.callSid}`);
      setSummary('');
      setIsComplete(false);
    } else {
      alert(`Error: ${data.error || 'Unknown error'}`);
    }
  };

  const handleCheckSummary = async () => {
    if (!callSid) return;
    const res = await fetch(`/api/call-summary?callSid=${callSid}`);
    const data = await res.json();
    if (data.error) {
      alert(`Error: ${data.error}`);
      return;
    }
    setSummary(data.summary || '');
    setIsComplete(data.isComplete || false);
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 20 }}>
      <h1>AI Outbound Call Demo</h1>
      <form onSubmit={handleSubmit}>
        <label>Phone Number to Call (E.164):</label>
        <input
          type="text"
          placeholder="+12223334444"
          value={toPhone}
          onChange={(e) => setToPhone(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
          required
        />

        <label>Greeting:</label>
        <input
          type="text"
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />

        <label>Topic:</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />

        <label>Ending:</label>
        <input
          type="text"
          value={ending}
          onChange={(e) => setEnding(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />

        <label>Questions (one per line):</label>
        <textarea
          value={questions}
          onChange={(e) => setQuestions(e.target.value)}
          style={{ width: '100%', marginBottom: 10, height: 70 }}
        />

        <label>Business Info:</label>
        <input
          type="text"
          value={businessInfo}
          onChange={(e) => setBusinessInfo(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />

        <button type="submit">Make Outbound AI Call</button>
      </form>

      {callSid && (
        <div style={{ marginTop: 30 }}>
          <p>Call SID: {callSid}</p>
          <button onClick={handleCheckSummary}>Check for Summary</button>
          <p>Call Complete? {isComplete ? 'Yes' : 'No'}</p>
          {summary && (
            <div>
              <h3>Conversation Summary</h3>
              <pre>{summary}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
