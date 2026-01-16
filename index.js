const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

// const serviceAccount = require("./loanlink-firebase-adminsdk.json");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(express.json());
const verifyFirebaseToken = async (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.z1gnsog.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const loanLinkDB = client.db("loanLinkDB");
    const loansCollection = loanLinkDB.collection("loans");
    const usersCollection = loanLinkDB.collection("users");
    const applicationsCollection = loanLinkDB.collection("applications");
    const paymentsCollection = loanLinkDB.collection("payments");
    const messagesCollection = loanLinkDB.collection("messages");

    // middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "admin" || user?.status !== "approved") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    const verifyManager = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "manager" || user?.status !== "approved") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    const verifyBorrower = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "borrower" || user?.status !== "approved") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    // Not Borrower
    const verifyNotBorrower = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (
        user?.role === "borrower" ||
        user?.status === "pending" ||
        user?.status === "suspended"
      ) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    // loans related apis
    app.post("/loans", verifyFirebaseToken, verifyManager, async (req, res) => {
      const loan = req.body;
      loan.createdAt = new Date();
      const result = await loansCollection.insertOne(loan);
      res.send(result);
    });
    app.get("/available-loans", async (req, res) => {
      const cursor = loansCollection
        .find({ showOnHome: true })
        .limit(8)
        .sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/loans", async (req, res) => {
      const {
        limit = 0,
        skip = 0,
        searchText = "",
        category = "",
        sortBy = "latest",
      } = req.query;

      const query = {};
      if (searchText) {
        query.title = { $regex: searchText, $options: "i" };
      }
      if (category) {
        query.category = category;
      }

      let sortQuery = { createdAt: -1 };
      if (sortBy === "interestLow") {
        sortQuery = { interestRate: 1 };
      } else if (sortBy === "interestHigh") {
        sortQuery = { interestRate: -1 };
      } else if (sortBy === "limitHigh") {
        sortQuery = { maxLoanLimit: -1 };
      } else if (sortBy === "limitLow") {
        sortQuery = { maxLoanLimit: 1 };
      }

      const cursor = loansCollection
        .find(query)
        .sort(sortQuery)
        .limit(Number(limit))
        .skip(Number(skip));
      const count = await loansCollection.countDocuments(query);
      const loans = await cursor.toArray();
      res.send({ loans, count });
    });
    app.get("/loans/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.findOne(query);
      res.send(result);
    });
    app.patch(
      "/loans/:id/show-on-home",
      verifyFirebaseToken,
      verifyNotBorrower,
      async (req, res) => {
        const updatedLoan = req.body;
        const query = { _id: new ObjectId(req.params.id) };
        const update = {
          $set: {
            showOnHome: updatedLoan.showOnHome,
          },
        };
        const result = await loansCollection.updateOne(query, update);
        res.send(result);
      }
    );
    app.patch(
      "/loans/:id",
      verifyFirebaseToken,
      verifyNotBorrower,
      async (req, res) => {
        const updatedLoan = req.body;
        const query = { _id: new ObjectId(req.params.id) };
        const update = {
          $set: {
            title: updatedLoan.title,
            description: updatedLoan.description,
            category: updatedLoan.category,
            interestRate: updatedLoan.interestRate,
            maxLoanLimit: updatedLoan.maxLoanLimit,
            emiPlans: updatedLoan.emiPlans,
            image: updatedLoan.image,
          },
        };
        const result = await loansCollection.updateOne(query, update);
        res.send(result);
      }
    );
    app.delete(
      "/loans/:id",
      verifyFirebaseToken,
      verifyNotBorrower,
      async (req, res) => {
        const query = { _id: new ObjectId(req.params.id) };
        const result = await loansCollection.deleteOne(query);
        res.send(result);
      }
    );

    // user related apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date();
      user.status = "pending";

      const userExist = await usersCollection.findOne({ email: user.email });
      if (userExist) {
        return res.send({ message: "User Already Exist" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    app.get("/users/:email/role", verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });
    app.get("/users", async (req, res) => {
      const { limit = 0, skip = 0, searchText = "", role = "" } = req.query;

      const query = {};
      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }
      if (role) {
        query.role = role;
      }

      const cursor = usersCollection
        .find(query)
        .limit(Number(limit))
        .skip(Number(skip));
      const count = await usersCollection.countDocuments(query);
      const users = await cursor.toArray();
      res.send({ users, count });
    });
    app.patch(
      "/users/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const updatedUser = req.body;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            role: updatedUser.role,
            status: updatedUser.status,
          },
        };
        const result = await usersCollection.updateOne(query, update);
        res.send(result);
      }
    );
    app.patch(
      "/users-upate/:id",
      verifyFirebaseToken,
      async (req, res) => {
        const id = req.params.id;
        const updatedUser = req.body;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            displayName: updatedUser.displayName,
            photoURL: updatedUser.photoURL,
          },
        };
        const result = await usersCollection.updateOne(query, update);
        res.send(result);
      }
    );
    app.get("/users/:id", verifyFirebaseToken, async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    // applications related apis
    app.post(
      "/loan-applications",
      verifyFirebaseToken,
      verifyBorrower,
      async (req, res) => {
        const application = req.body;
        application.createdAt = new Date();
        const result = await applicationsCollection.insertOne(application);
        res.send(result);
      }
    );
    app.get("/loan-applications", verifyFirebaseToken, async (req, res) => {
      const { status, email, limit = 0, skip = 0 } = req.query;
      const query = {};
      if (status) {
        query.status = status;
      }
      if (email) {
        query.userEmail = email;
      }
      const cursor = applicationsCollection
        .find(query)
        .limit(Number(limit))
        .skip(Number(skip))
        .sort({ createdAt: -1 });
      const applications = await cursor.toArray();
      const count = await applicationsCollection.countDocuments(query);
      res.send({ applications, count });
    });
    app.patch(
      "/loan-applications/:id",
      verifyFirebaseToken,
      async (req, res) => {
        const { status } = req.body;
        const query = { _id: new ObjectId(req.params.id) };
        const setFields = { status: status };

        if (status === "approved") {
          setFields.approvedAt = new Date();
        } else if (status === "rejected") {
          setFields.rejectedAt = new Date();
        } else if (status === "applied") {
          setFields.applicationFeeStatus = "unpaid";
          const paymentQuery = { applicationId: req.params.id };
          const paymentResult = await paymentsCollection.deleteOne(
            paymentQuery
          );
        }

        const update = {
          $set: setFields,
        };
        const result = await applicationsCollection.updateOne(query, update);
        res.send(result);
      }
    );

    // Payment related api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = 1000;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.loanTitle,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.userEmail,
        mode: "payment",
        metadata: {
          applicationId: paymentInfo.applicationId,
          loanTitle: paymentInfo.loanTitle,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      // console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(" In payment success " ,session);
      const transactionId = session.payment_intent;
      const existQuery = { transactionId: transactionId };
      const paymentExist = await paymentsCollection.findOne(existQuery);
      if (paymentExist) {
        return res.send({
          message: "payment already exist.",
          paymentInfo: paymentExist,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.applicationId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            applicationFeeStatus: "paid",
            status: "pending",
          },
        };
        const result = await applicationsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          borrowerEmail: session.customer_email,
          applicationId: session.metadata.applicationId,
          loanTitle: session.metadata.loanTitle,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        const resultPayment = await paymentsCollection.insertOne(payment);

        return res.send({
          success: true,
          modifiedApplication: result,
          paymentInfo: payment,
          transactionId: session.payment_intent,
        });
      }

      return res.send({ success: false });
    });

    // aggregation pipelines
    app.get(
      "/applications/stats/status",
      verifyFirebaseToken,
      async (req, res) => {
        const pipeline = [{ $group: { _id: "$status", count: { $sum: 1 } } }];

        const applications = await applicationsCollection
          .aggregate(pipeline)
          .toArray();
        const totalCount = await applicationsCollection.countDocuments();
        res.send({ applications, totalCount });
      }
    );
    app.get(
      "/applications/stats/amounts",
      verifyFirebaseToken,
      async (req, res) => {
        const pipeline = [
          { $match: { status: "approved" } },
          {
            $group: {
              _id: "$status",
              totalApprovedAmount: { $sum: "$loanAmount" },
            },
          },
        ];
        const result = await applicationsCollection
          .aggregate(pipeline)
          .toArray();
        res.send(result);
      }
    );
    app.get(
      "/users-stats/role",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const pipeline = [
          { $match: { status: "approved" } },
          { $group: { _id: "$role", count: { $sum: 1 } } },
        ];
        const result = await usersCollection.aggregate(pipeline).toArray();
        res.send(result);
      }
    );

    app.get(
      "/applications/stats/top-categories",
      verifyFirebaseToken,
      async (req, res) => {
        const pipeline = [
          { $group: { _id: "$loanCategory", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $project: { category: "$_id", count: 1, _id: 0 } },
          { $limit: 5 },
        ];
        const result = await applicationsCollection
          .aggregate(pipeline)
          .toArray();
        res.send(result);
      }
    );
    app.get(
      "/applications/stats/borrower",
      verifyFirebaseToken,
      async (req, res) => {
        const { email } = req.query;

        const pipeline = [
          { $match: { userEmail: email, status: "approved" } },
          {
            $group: {
              _id: "$status",
              totalAmount: { $sum: "$loanAmount" },
              count: { $sum: 1 },
            },
          },
          { $project: { totalAmount: 1, _id: 0, count: 1 } },
        ];
        const result = await applicationsCollection
          .aggregate(pipeline)
          .toArray();
        res.send(result);
      }
    );
    app.get("/payments", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.borrowerEmail = email;
      }
      const cursor = paymentsCollection
        .find(query)
        .sort({ paidAt: -1 })
        .limit(8);
      const result = await cursor.toArray();
      res.send(result);
    });

    // message related api
    app.post("/messages", async (req, res) => {
      const message = req.body;
      const result = await messagesCollection.insertOne(message);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("LoanLink is running");
});

app.listen(port, () => {
  console.log(`LoanLink is running on port ${port}`);
});
