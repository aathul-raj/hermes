"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";
import styles from "./BusinessSignUpForm.module.css";

const BusinessSignUpPage: React.FC = () => {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [hours, setHours] = useState([{ dayOfWeek: "", openTime: "", closeTime: "" }]);
  const [employees, setEmployees] = useState([
    { name: "", role: "", hours: [{ dayOfWeek: "", openTime: "", closeTime: "" }] },
  ]);

  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await fetch("/api/business-signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, phone, location, description, hours, employees }),
      });

      if (response.ok) {
        // Clear the existing activeBusiness cookie and set a new one
        Cookies.remove("activeBusiness");
        Cookies.set("activeBusiness", name, { expires: 7 }); // Cookie expires in 7 days

        // Navigate to the dashboard
        router.push("/dashboard");
      } else {
        alert("Error signing up business. Please try again.");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Error signing up business. Please try again.");
    }
  };

  const addHour = () => {
    setHours([...hours, { dayOfWeek: "", openTime: "", closeTime: "" }]);
  };

  const updateHour = (index: number, field: string, value: string) => {
    const updatedHours = [...hours];
    updatedHours[index][field] = value;
    setHours(updatedHours);
  };

  const addEmployee = () => {
    setEmployees([
      ...employees,
      { name: "", role: "", hours: [{ dayOfWeek: "", openTime: "", closeTime: "" }] },
    ]);
  };

  const updateEmployee = (employeeIndex: number, field: string, value: string) => {
    const updatedEmployees = [...employees];
    updatedEmployees[employeeIndex][field] = value;
    setEmployees(updatedEmployees);
  };

  const addEmployeeHour = (employeeIndex: number) => {
    const updatedEmployees = [...employees];
    updatedEmployees[employeeIndex].hours.push({ dayOfWeek: "", openTime: "", closeTime: "" });
    setEmployees(updatedEmployees);
  };

  const updateEmployeeHour = (
    employeeIndex: number,
    hourIndex: number,
    field: string,
    value: string
  ) => {
    const updatedEmployees = [...employees];
    updatedEmployees[employeeIndex].hours[hourIndex][field] = value;
    setEmployees(updatedEmployees);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="name">Business Name</label>
        <input
          className={styles.input}
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="phone">Phone Number</label>
        <input
          className={styles.input}
          type="tel"
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="location">Location</label>
        <input
          className={styles.input}
          type="text"
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          required
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="description">Description</label>
        <textarea
          className={styles.input}
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div className={styles.formGroup}>
        <h3>Hours of Operation</h3>
        {hours.map((hour, index) => (
          <div key={index} className={styles.hourRow}>
            <input
              className={styles.input}
              type="text"
              placeholder="Day of Week"
              value={hour.dayOfWeek}
              onChange={(e) => updateHour(index, "dayOfWeek", e.target.value)}
              required
            />
            <input
              className={styles.input}
              type="time"
              placeholder="Open Time"
              value={hour.openTime}
              onChange={(e) => updateHour(index, "openTime", e.target.value)}
              required
            />
            <input
              className={styles.input}
              type="time"
              placeholder="Close Time"
              value={hour.closeTime}
              onChange={(e) => updateHour(index, "closeTime", e.target.value)}
              required
            />
          </div>
        ))}
        <button type="button" onClick={addHour}>
          Add Hour
        </button>
      </div>

      <div className={styles.formGroup}>
        <h3>Employees</h3>
        {employees.map((employee, employeeIndex) => (
          <div key={employeeIndex} className={styles.employeeSection}>
            <label className={styles.label}>Employee Name</label>
            <input
              className={styles.input}
              type="text"
              value={employee.name}
              onChange={(e) => updateEmployee(employeeIndex, "name", e.target.value)}
              required
            />
            <label className={styles.label}>Role</label>
            <input
              className={styles.input}
              type="text"
              value={employee.role}
              onChange={(e) => updateEmployee(employeeIndex, "role", e.target.value)}
              required
            />
            <h4>Hours</h4>
            {employee.hours.map((hour, hourIndex) => (
              <div key={hourIndex} className={styles.hourRow}>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="Day of Week"
                  value={hour.dayOfWeek}
                  onChange={(e) =>
                    updateEmployeeHour(employeeIndex, hourIndex, "dayOfWeek", e.target.value)
                  }
                  required
                />
                <input
                  className={styles.input}
                  type="time"
                  placeholder="Open Time"
                  value={hour.openTime}
                  onChange={(e) =>
                    updateEmployeeHour(employeeIndex, hourIndex, "openTime", e.target.value)
                  }
                  required
                />
                <input
                  className={styles.input}
                  type="time"
                  placeholder="Close Time"
                  value={hour.closeTime}
                  onChange={(e) =>
                    updateEmployeeHour(employeeIndex, hourIndex, "closeTime", e.target.value)
                  }
                  required
                />
              </div>
            ))}
            <button type="button" onClick={() => addEmployeeHour(employeeIndex)}>
              Add Hour for Employee
            </button>
          </div>
        ))}
        <button type="button" onClick={addEmployee}>
          Add Employee
        </button>
      </div>

      <button type="submit" className={styles.submitButton}>
        Sign Up
      </button>
    </form>
  );
};

export default BusinessSignUpPage;
