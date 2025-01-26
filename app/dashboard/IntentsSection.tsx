"use client";

import React, { useEffect, useState } from "react";
import styles from "./IntentsSection.module.css";

const IntentsSection: React.FC<{ business: any }> = ({ business }) => {
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showIntentForm, setShowIntentForm] = useState(false);

  const formatBusinessInfo = (business: any) => {
    const hours = business.hours
      ?.map((hour: any) => `${hour.dayOfWeek}: ${hour.openTime} - ${hour.closeTime}`)
      .join("\n") || "No hours available";
    
    const employees = business.employees
      ?.map((employee: any) => {
        const empHours = employee.hours
          ?.map((hour: any) => `${hour.dayOfWeek}: ${hour.openTime} - ${hour.closeTime}`)
          .join("\n") || "No hours listed";
        return `${employee.name} (job title: ${employee.role})\n${empHours}`;
      })
      .join("\n\n") || "No employees available";
  
    return `
      Business Name: ${business.name}
      Phone: ${business.phone || "No phone available"}
      Location: ${business.location || "No location available"}
      Description: ${business.description || "No description available"}
      Hours:
      ${hours}
      
      Employees:
      ${employees}
    `.trim();
  };

  const [newIntent, setNewIntent] = useState({
    name: "",
    greetingMessage: "",
    conversationTopic: "",
    endingMessage: "",
    questions: "",
    businessInfo: formatBusinessInfo(business),
  });
  
  useEffect(() => {
    setNewIntent((prev) => ({
      ...prev,
      businessInfo: formatBusinessInfo(business),
    }));
  }, [business]);
  

  // Fetch intents from the database
  const fetchIntents = async () => {
    try {
      const response = await fetch(`/api/get-intents?businessName=${encodeURIComponent(business.name)}`);
      if (!response.ok) {
        throw new Error("Failed to fetch intents.");
      }
      const intentsData = await response.json();
      setIntents(intentsData);
    } catch (err) {
      console.error("Error fetching intents:", err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch intents on component load
  useEffect(() => {
    fetchIntents();
  }, [business.name]);

  // Handle form submission for new intent
  const handleNewIntentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
  
    const tempIntent = {
      id: Date.now(), // Temporary ID
      name: newIntent.name,
      greetingMessage: newIntent.greetingMessage,
      conversationTopic: newIntent.conversationTopic,
      endingMessage: newIntent.endingMessage,
      questions: newIntent.questions.split(",").map((q) => q.trim()),
      businessInfo: newIntent.businessInfo,
    };
  
    setIntents((prev) => [...prev, tempIntent]);
  
    try {
      const response = await fetch("/api/add-intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessName: business.name,
          name: newIntent.name,
          greetingMessage: newIntent.greetingMessage,
          conversationTopic: newIntent.conversationTopic,
          endingMessage: newIntent.endingMessage,
          questions: newIntent.questions.split(",").map((q) => q.trim()),
          businessInfo: newIntent.businessInfo,
        }),
      });
  
      if (!response.ok) {
        throw new Error("Failed to create new intent.");
      }
  
      const createdIntent = await response.json();
  
      // Replace the temporary intent with the server's response
      setIntents((prev) =>
        prev.map((intent) => (intent.id === tempIntent.id ? createdIntent : intent))
      );
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert("Failed to create new intent. Please try again.");
  
      // Roll back the temporary intent
      setIntents((prev) => prev.filter((intent) => intent.id !== tempIntent.id));
    } finally {
      setShowIntentForm(false);
      setNewIntent({
        name: "",
        greetingMessage: "",
        conversationTopic: "",
        endingMessage: "",
        questions: "",
        businessInfo: formatBusinessInfo(business),
      });
    }
  };
  
  
  

  return (
    <div className={styles.intentsSection}>
      <div className={styles.intentsHeader}>
        <h1>Intents</h1>
        <button onClick={() => setShowIntentForm(true)} className={styles.newIntentButton}>
          New Intent
        </button>
      </div>

      {loading ? (
        <div>Loading intents...</div>
      ) : intents.length > 0 ? (
        <div className={styles.intentsList}>
          {intents.map((intent: any) => (
            <div key={intent.id} className={styles.intentCard}>
              <h3>{intent.name}</h3>
              <p>
                <strong>Greeting:</strong> {intent.greetingMessage}
              </p>
              <p>
                <strong>Ending:</strong> {intent.endingMessage}
              </p>
              <p>
                <strong>Questions:</strong> {intent.questions.join(", ")}
              </p>
              <p>
                <strong>Info:</strong> {intent.businessInfo}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div>No intents available for this business.</div>
      )}

      {showIntentForm && (
        <div className={styles.intentFormModal}>
          <div className={styles.modalBackdrop} onClick={() => setShowIntentForm(false)}></div>
          <form onSubmit={handleNewIntentSubmit} className={styles.intentForm}>
            <h2>New Intent</h2>
            <label>
              Intent Name
              <input
                type="text"
                value={newIntent.name}
                onChange={(e) => setNewIntent({ ...newIntent, name: e.target.value })}
                required
              />
            </label>
            <label>
              Greeting Message
              <input
                type="text"
                value={newIntent.greetingMessage}
                onChange={(e) => setNewIntent({ ...newIntent, greetingMessage: e.target.value })}
                required
              />
            </label>
            <label>
              Conversation Topic
              <input
                type="text"
                value={newIntent.conversationTopic}
                onChange={(e) => setNewIntent({ ...newIntent, conversationTopic: e.target.value })}
                required
              />
            </label>
            <label>
              Ending Message
              <input
                type="text"
                value={newIntent.endingMessage}
                onChange={(e) => setNewIntent({ ...newIntent, endingMessage: e.target.value })}
                required
              />
            </label>
            <label>
              Questions (comma-separated)
              <input
                type="text"
                value={newIntent.questions}
                onChange={(e) => setNewIntent({ ...newIntent, questions: e.target.value })}
                required
              />
            </label>
            <label>
  Business Information
  <textarea
    value={newIntent.businessInfo}
    onChange={(e) => setNewIntent({ ...newIntent, businessInfo: e.target.value })}
    required
    rows={10}
  />
</label>

            <button type="submit" className={styles.saveButton}>
              Save
            </button>
            <button type="button" onClick={() => setShowIntentForm(false)} className={styles.cancelButton}>
              Cancel
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default IntentsSection;
