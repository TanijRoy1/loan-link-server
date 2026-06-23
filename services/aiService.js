const axios = require("axios");

// CALL AI SERVICE
const generateAIReport = async (loanData) => {
  try {
    const response = await axios.post(
      `${process.env.AI_SERVICE_URL}/api/reports`,
      loanData,
      {
        timeout: 15000, // IMPORTANT
      },
    );

    return response.data;
  } catch (error) {
    console.error("AI Service Error:", {
      message: error.message,
      status: error.response?.status,
    });

    throw new Error("AI service unavailable");
  }
};

// VALIDATION
const validateAIRequest = (application) => {
  if (!application) {
    throw new Error("Application not found");
  }

  if (!application.monthlyIncome || !application.loanAmount) {
    throw new Error("Missing financial data");
  }

  if (!application.firstName || !application.lastName) {
    throw new Error("Missing applicant name");
  }

  return true;
};

// PAYLOAD BUILDER
const buildAIPayload = (application, user, loan) => {
  return {
    loanId: application.loanId,
    userId: user?._id?.toString(),

    applicantName: `${application.firstName} ${application.lastName}`,

    monthlyIncome: Number(application.monthlyIncome),
    loanAmount: Number(application.loanAmount),

    duration: application.selectedEmiPlan
      ? parseInt(application.selectedEmiPlan)
      : 12,

    purpose: application.reason || "Not specified",
  };
};

module.exports = {
  generateAIReport,
  validateAIRequest,
  buildAIPayload,
};
