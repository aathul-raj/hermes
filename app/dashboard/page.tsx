"use client";

import React, { useEffect, useState } from "react";
import Cookies from "js-cookie";
import styles from "./Dashboard.module.css";
import IntentsSection from "./IntentsSection";

interface QueueItem {
  callLogId: number;
  name: string;
  phone: string;
  intentName: string;
  status: string;
  businessId: number;
}

interface CallLog {
  id: number;
  name: string;
  phoneNumber: string;
  intentName: string;
  status: string;
  sentiment?: string;
  summary?: string;
  flag?: string;
  transcript?: string;
  businessId: number;
  startTime?: Date;
  endTime?: Date;
}

const Dashboard: React.FC = () => {
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [selectedCustomers, setSelectedCustomers] = useState<number[]>([]);
  const [intents, setIntents] = useState([]);
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [showNewCallForm, setShowNewCallForm] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false); // Add customer form state
  const [selectedIntent, setSelectedIntent] = useState("");
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: ""});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("logs");
  const [activeSidebarTab, setActiveSidebarTab] = useState("dashboard");
  const [callQueue, setCallQueue] = useState<any[]>([]);
  const [isCalling, setIsCalling] = useState(false);
  const [selectedCallLog, setSelectedCallLog] = useState<CallLog | null>(null);


  const handleNewCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      for (const customerId of selectedCustomers) {
        const customer = selectedBusiness.customers.find((c) => c.id === customerId);
        const sanitizedPhone = customer.phone.startsWith("+1")
          ? customer.phone
          : `+1${customer.phone}`;

        // Create initial call log
        const response = await fetch("/api/add-call-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: customer.name,
            phone: sanitizedPhone,
            intentName: selectedIntent,
            status: "queued",
            businessId: selectedBusiness.id,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create call log for ${customer.name}`);
        }

        const callLog = await response.json();

        // Add to queue with callLogId
        setCallQueue((prevQueue) => [...prevQueue, {
          callLogId: callLog.id,
          name: customer.name,
          phone: sanitizedPhone,
          intentName: selectedIntent,
          status: "queued",
          businessId: selectedBusiness.id,
        }]);

        // Update call logs display
        setCallLogs((prevLogs) => [...prevLogs, callLog]);
      }

      setShowNewCallForm(false);
      setSelectedCustomers([]);
      setSelectedIntent("");
    } catch (error) {
      console.error("Error creating calls:", error);
      setError(error.message);
    }
  };

  const processNextCall = async () => {
    if (isCalling || callQueue.length === 0) return;
  
    setIsCalling(true);
    const currentCall = callQueue[0];
    let pollInterval: NodeJS.Timeout; // Declare this so we can clear it in catch block
  
    try {
      // Update status to "calling"
      await fetch(`/api/update-call-log/${currentCall.callLogId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "calling" }),
      });
  
      // Update local call logs
      setCallLogs((prevLogs) => 
        prevLogs.map((log) =>
          log.id === currentCall.callLogId 
            ? { ...log, status: "calling" }
            : log
        )
      );
  
      // Fetch intent details
      const intentResponse = await fetch(
        `/api/get-intent-info?intentName=${encodeURIComponent(currentCall.intentName)}`
      );
      if (!intentResponse.ok) throw new Error("Failed to fetch intent details");
      const intentDetails = await intentResponse.json();
  
      // Start the call
      const response = await fetch("/api/outbound-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toPhone: currentCall.phone,
          greeting: `Hi ${currentCall.name}, ${intentDetails.greetingMessage}`,
          topic: intentDetails.conversationTopic,
          ending: intentDetails.endingMessage,
          questions: intentDetails.questions,
          businessInfo: intentDetails.businessInfo,
          callLogId: currentCall.callLogId,
        }),
      });
  
      if (!response.ok) throw new Error("Failed to start call");
      const { callSid } = await response.json();
  
      // Poll for call completion
      pollInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch(`/api/call-status?callSid=${callSid}`);
          const statusData = await statusResponse.json();
  
          // Update local call logs with current status
          setCallLogs((prevLogs) =>
            prevLogs.map((log) =>
              log.id === currentCall.callLogId 
                ? { ...log, 
                  status: statusData.status,
                  transcript: statusData.transcript }
                : log
            )
          );
  
          if (statusData.status === "completed") {
            clearInterval(pollInterval);
  
            // Analyze the call
            const analysisResponse = await fetch("/api/analyze-call", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transcript: statusData.transcript }),
            });
            
            if (!analysisResponse.ok) {
              throw new Error("Failed to analyze call");
            }
            
            const analysisData = await analysisResponse.json();
  
            // Update call log with results
            const updateResponse = await fetch(`/api/update-call-log/${currentCall.callLogId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                status: "completed",
                transcript: statusData.transcript,
                sentiment: analysisData.sentiment,
                summary: analysisData.summary,
                flag: analysisData.tag,
              }),
            });
  
            if (!updateResponse.ok) {
              throw new Error("Failed to update call log with analysis");
            }
  
            const updatedCallLog = await updateResponse.json();
  
            // Update local state
            setCallLogs((prevLogs) =>
              prevLogs.map((log) =>
                log.id === currentCall.callLogId ? updatedCallLog : log
              )
            );
  
            // Remove from queue and continue
            setCallQueue((prevQueue) => prevQueue.slice(1));
            setIsCalling(false);
          }
        } catch (error) {
          console.error("Error polling status:", error);
          clearInterval(pollInterval);
  
          // Update call log with error status
          try {
            const errorResponse = await fetch(`/api/update-call-log/${currentCall.callLogId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                status: "error",
                summary: error.message,
              }),
            });
  
            if (errorResponse.ok) {
              const updatedCallLog = await errorResponse.json();
              // Update local state
              setCallLogs((prevLogs) =>
                prevLogs.map((log) =>
                  log.id === currentCall.callLogId ? updatedCallLog : log
                )
              );
            }
          } catch (updateError) {
            console.error("Error updating call log with error status:", updateError);
          }
  
          setCallQueue((prevQueue) => prevQueue.slice(1));
          setIsCalling(false);
        }
      }, 5000);
  
      // Add safety timeout
      setTimeout(() => {
        clearInterval(pollInterval);
        setIsCalling(false);
        // Update call log if we hit the timeout
        fetch(`/api/update-call-log/${currentCall.callLogId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "error",
            summary: "Call timed out after 5 minutes",
          }),
        }).catch(err => console.error("Error updating call log after timeout:", err));
      }, 300000); // 5 minute timeout
  
    } catch (error) {
      console.error("Error processing call:", error);
      if (pollInterval) clearInterval(pollInterval);
      setIsCalling(false);
  
      // Update call log with error status
      try {
        const errorResponse = await fetch(`/api/update-call-log/${currentCall.callLogId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "error",
            summary: error.message,
          }),
        });
  
        if (errorResponse.ok) {
          const updatedCallLog = await errorResponse.json();
          // Update local state
          setCallLogs((prevLogs) =>
            prevLogs.map((log) =>
              log.id === currentCall.callLogId ? updatedCallLog : log
            )
          );
        }
      } catch (updateError) {
        console.error("Error updating call log with error status:", updateError);
      }
  
      setCallQueue((prevQueue) => prevQueue.slice(1));
      setIsCalling(false);
    }
  };
  

  useEffect(() => {
    processNextCall();
  }, [callQueue]);

  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        const activeBusiness = Cookies.get("activeBusiness");

        if (activeBusiness) {
          const response = await fetch(`/api/business-info?name=${encodeURIComponent(activeBusiness)}`);
          if (!response.ok) throw new Error("Failed to fetch active business details.");

          const businessData = await response.json();
          setSelectedBusiness(businessData);

          const intentsResponse = await fetch(`/api/get-intents?businessName=${encodeURIComponent(activeBusiness)}`);
          if (!intentsResponse.ok) throw new Error("Failed to fetch intents.");

          const intentsData = await intentsResponse.json();
          setIntents(intentsData);
        } else {
          const response = await fetch("/api/business-names");
          if (!response.ok) throw new Error("Failed to fetch businesses.");

          const data = await response.json();
          setBusinesses(data);
        }
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, []);

  useEffect(() => {
    const fetchCallLogs = async () => {
      try {
        const response = await fetch("/api/get-call-logs");
        if (!response.ok) throw new Error("Failed to fetch call logs.");

        const logs = await response.json();
        setCallLogs(logs);
      } catch (err) {
        console.error(err);
        setError(err.message);
      }
    };

    fetchCallLogs();
  }, []);

  useEffect(() => {
    if (selectedCallLog) {
      const updatedLog = callLogs.find((log) => log.id === selectedCallLog.id);
      if (updatedLog) {
        setSelectedCallLog(updatedLog);
      }
    }
  }, [callLogs, selectedCallLog]);
  

  const selectBusiness = (businessName: string) => {
    Cookies.set("activeBusiness", businessName, { expires: 7 });
    window.location.reload();
  };

  const toggleCustomerSelection = (customerId: number) => {
    setSelectedCustomers((prev) =>
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]
    );
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/add-customer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newCustomer.name,
          phone: newCustomer.phone,
          businessId: selectedBusiness.id,
        }),
      });

      if (!response.ok) throw new Error("Failed to add customer.");

      const updatedBusiness = await response.json();
      setSelectedBusiness(updatedBusiness);
      setShowCustomerForm(false);
      setNewCustomer({ name: "", phone: "" });
    } catch (err) {
      console.error(err);
      alert("Failed to add customer. Please try again.");
    }
  };

  const getSentimentClass = (sentiment: string | undefined) => {
    switch (sentiment) {
      case "positive":
        return styles.positiveSentiment;
      case "negative":
        return styles.negativeSentiment;
      case "neutral":
        return styles.neutralSentiment;
      default:
        return styles.unknownSentiment;
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  if (!selectedBusiness) {
    return (
      <div className={styles.selectBusinessContainer}>
        <h1>Select a Business</h1>
        <ul className={styles.businessList}>
          {businesses.map((business: any, index: number) => (
            <li key={business.id || index} className={styles.businessItem}>
              <button onClick={() => selectBusiness(business.name)}>{business.name}</button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={styles.dashboardContainer}>
      <aside className={styles.sidebar}>
        <h2 className={styles.businessName}>{selectedBusiness.name}</h2>
        <hr className={styles.divider} />
        <ul className={styles.sidebarLinks}>
          <li>
            <button onClick={() => setActiveSidebarTab("dashboard")}>Dashboard</button>
          </li>
          <li>
            <button onClick={() => setActiveSidebarTab("knowledgeBase")}>Knowledge Base</button>
          </li>
          <li>
            <button onClick={() => setActiveSidebarTab("intents")}>Intents</button>
          </li>
        </ul>
        <div className={styles.pinnedTickets}></div>
        <footer className={styles.footer}>HERMES</footer>
      </aside>

      <main className={styles.mainContent}>
        {activeSidebarTab === "dashboard" ? (
          <div className={styles.dashboardTabs}>
            <h1>Dashboard</h1>
            <div className={styles.tabHeader}>
              <button className={activeTab === "logs" ? styles.activeTab : ""} onClick={() => setActiveTab("logs")}>
                Logs
              </button>
              <button className={activeTab === "customers" ? styles.activeTab : ""} onClick={() => setActiveTab("customers")}>
                Customers
              </button>
            </div>

            {activeTab === "logs" ? (
              <div className={styles.logs}>
              <h2>Call Logs</h2>
              <table className={styles.callLogTable}>
                <thead>
                  <tr>
                    <th>Ticket ID</th>
                    <th>Customer Name</th>
                    <th>Intent</th>
                    <th>Status</th>
                    <th>Flag</th>
                    <th>Start Time</th>
                    <th>End Time</th>
                    <th>Phone Number</th>
                  </tr>
                </thead>
                <tbody>
                  {callLogs.map((log, index) => (
                    <tr
                      key={log.id}
                      className={styles.callLogRow}
                      onClick={() => setSelectedCallLog(log)}
                    >
                      <td>{index + 1}</td>
                      <td>{log.name || "N/A"}</td>
                      <td>{log.intentName || "N/A"}</td>
                      <td className={`${styles.status} ${styles[log.status]}`}>
                        {log.status || "N/A"}
                      </td>
                      <td
                        className={log.flag === "Needs Review" ? styles.needsReviewFlag : ""}
                      >
                        {log.flag || "None"}
                      </td>
                      <td>
                        {log.startTime
                          ? new Date(log.startTime).toLocaleString()
                          : "Not Started"}
                      </td>
                      <td>
                        {log.endTime
                          ? new Date(log.endTime).toLocaleString()
                          : "Not Ended"}
                      </td>
                      <td>{log.phoneNumber || "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            
              {selectedCallLog && (
  <div className={styles.popupBackdrop} onClick={() => setSelectedCallLog(null)}>
    <div className={styles.popup}>
      <h3 className={styles.popupTitle}>Call Summary</h3>
      <div className={styles.popupContent}>
        <p>
          <strong>Customer:</strong> {selectedCallLog.name || "N/A"}
        </p>
        <p>
          <strong>Intent:</strong> {selectedCallLog.intentName || "N/A"}
        </p>
        <p>
          <strong>Sentiment:</strong>{" "}
          <span className={getSentimentClass(selectedCallLog.sentiment)}>
            {selectedCallLog.sentiment || "N/A"}
          </span>
        </p>
        <p>
          <strong>Summary:</strong> {selectedCallLog.summary || "No summary available"}
        </p>
        <p>
          <strong>Transcript:</strong>
        </p>
        <div className={styles.transcript}>
          {selectedCallLog.transcript
            ? selectedCallLog.transcript.split("\n").map((line, index) => (
                <p
                  key={index}
                  className={
                    line.startsWith("Assistant:") ? styles.assistantMessage : styles.userMessage
                  }
                >
                  {line}
                </p>
              ))
            : "No transcript available"}
        </div>
      </div>
      <button onClick={() => setSelectedCallLog(null)} className={styles.closeButton}>
        Close
      </button>
    </div>
  </div>
)}

            </div>
            
            ) : (
              <div>
                <div className={styles.customerHeader}>
                  <h2>Customers</h2>
                  <div className={styles.buttonGroup}>
                    <button className={styles.addCustomerButton} onClick={() => setShowCustomerForm(true)}>
                      Add Customer
                    </button>
                    {selectedCustomers.length > 0 && (
                      <button className={styles.newCallButton} onClick={() => setShowNewCallForm(true)}>
                        New Call
                      </button>
                    )}
                  </div>
                </div>
                <table className={styles.customersTable}>
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Name</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBusiness.customers.map((customer: any) => (
                      <tr key={customer.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedCustomers.includes(customer.id)}
                            onChange={() => toggleCustomerSelection(customer.id)}
                          />
                        </td>
                        <td>{customer.name}</td>
                        <td>{customer.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {showCustomerForm && (
                  <div className={styles.customerFormModal}>
                  <div className={styles.customerFormContainer}>
                    <form onSubmit={handleAddCustomer} className={styles.customerForm}>
                      <h2>Add Customer</h2>
                      <label>
                        Customer Name
                        <input
                          type="text"
                          value={newCustomer.name}
                          onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                          required
                        />
                      </label>
                      <label>
                        Customer Phone
                        <input
                          type="tel"
                          value={newCustomer.phone}
                          onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                          required
                        />
                      </label>
                      <button type="submit" className={styles.saveButton}>
                        Save
                      </button>
                      <button type="button" onClick={() => setShowCustomerForm(false)} className={styles.cancelButton}>
                        Cancel
                      </button>
                    </form>
                  </div>
                </div>
                
                )}

{showNewCallForm && (
  <div className={styles.newCallFormModal}>
    <div className={styles.newCallFormContainer}>
      <form
        onSubmit={handleNewCallSubmit}
        className={styles.newCallForm}
      >
        <h2>New Call</h2>
        <label>
          Select Intent
          <select
            value={selectedIntent}
            onChange={(e) => setSelectedIntent(e.target.value)}
            required
            onFocus={async () => {
              if (intents.length === 0) {
                try {
                  const response = await fetch(
                    `/api/get-intents?businessName=${encodeURIComponent(selectedBusiness.name)}`
                  );
                  if (!response.ok) throw new Error("Failed to fetch intents.");
                  const intentsData = await response.json();
                  setIntents(intentsData);
                } catch (err) {
                  console.error("Error fetching intents:", err);
                  alert("Failed to load intents. Please try again.");
                }
              }
            }}
          >
            <option value="">Select an intent</option>
            {intents.map((intent) => (
              <option key={intent.id} value={intent.name}>
                {intent.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.saveButton}>
          Start Call
        </button>
        <button
          type="button"
          onClick={() => setShowNewCallForm(false)}
          className={styles.cancelButton}
        >
          Cancel
        </button>
      </form>
    </div>
  </div>
)}

              </div>
            )}
          </div>
        ) : activeSidebarTab === "knowledgeBase" ? (
          <div className={styles.knowledgeBase}>
            <h1>Knowledge Base</h1>
            <p>
              <strong>Phone:</strong> {selectedBusiness.phone}
            </p>
            <p>
              <strong>Location:</strong> {selectedBusiness.location}
            </p>
            <p>
              <strong>Description:</strong> {selectedBusiness.description}
            </p>
          </div>
        ) : (
          <IntentsSection business={selectedBusiness} />
        )}
      </main>
    </div>
  );
};

export default Dashboard;