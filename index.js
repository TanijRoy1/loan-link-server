const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./loanlink-firebase-adminsdk.json");

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
    await client.connect();

    const loanLinkDB = client.db("loanLinkDB");
    const loansCollection = loanLinkDB.collection("loans");
    const usersCollection = loanLinkDB.collection("users");
    const applicationsCollection = loanLinkDB.collection("applications");

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
      if (user?.role === "borrower" || user?.status === "pending" || user?.status === "suspended") {
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
        .limit(6)
        .sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/loans", async (req, res) => {
      const cursor = loansCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/loans/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.findOne(query);
      res.send(result);
    });
    app.patch("/loans/:id/show-on-home", verifyFirebaseToken, verifyNotBorrower, async (req, res) => {
      const updatedLoan = req.body;
      const query = {_id : new ObjectId(req.params.id)};
      const update = {
        $set: {
          showOnHome: updatedLoan.showOnHome
        }
      }
      const result = await loansCollection.updateOne(query, update);
      res.send(result);
    })
    app.patch("/loans/:id", verifyFirebaseToken, verifyNotBorrower, async (req, res) => {
      const updatedLoan = req.body;
      const query = {_id : new ObjectId(req.params.id)};
      const update = {
        $set: {
          title : updatedLoan.title,
          description: updatedLoan.description,
          category: updatedLoan.category,
          interestRate: updatedLoan.interestRate,
          maxLoanLimit: updatedLoan.maxLoanLimit,
          emiPlans: updatedLoan.emiPlans,
          image: updatedLoan.image
        }
      }
      const result = await loansCollection.updateOne(query, update);
      res.send(result);
    })
    app.delete("/loans/:id", verifyFirebaseToken, verifyNotBorrower, async (req, res) => {
      const query = {_id : new ObjectId(req.params.id)};
      const result = await loansCollection.deleteOne(query);
      res.send(result);
    })

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
    app.get("/users/:email/role",verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });
    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    })
    app.patch("/users/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updatedUser = req.body;
      const query = {_id: new ObjectId(id)};
      const update = {
        $set: {
          role : updatedUser.role,
          status: updatedUser.status
        }
      }
      const result = await usersCollection.updateOne(query, update);
      res.send(result);
    })


    // applications related apis
    app.post("/loan-applications", verifyFirebaseToken, verifyBorrower, async (req, res) => {
      const application = req.body;
      application.createdAt = new Date();
      const result = await applicationsCollection.insertOne(application);
      res.send(result);
    })



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
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
