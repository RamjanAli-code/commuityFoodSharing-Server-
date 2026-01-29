require("dotenv").config();
const admin = require("firebase-admin");
const serviceAccount = require("./firbase-admin.json");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

console.log("Firebase connected successfully");
async function verifyToken(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized-No Token" });
    }
    const token = header.split(" ")[1];
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = {
            email: decoded.email,
            name: decoded.name || decoded.displayName,
            photoURL: decoded.picture || "https://i.ibb.co/hFLBkyBD/1j.webp",
            uid: decoded.uid

        };
        next();
    } catch (err) {
        return res.status(401).send({ message: "Invalid Token" });
    }
}
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

app.get("/", (req, res) => {
    res.send("Food Sharing Server Running");
});
async function run() {
    //await client.connect();
    console.log("MongoDB Connected Successfully");
    const db = client.db("foodDB");
    const foodsCollection = db.collection("foods");
    const foodRequestsCollection = db.collection("foodRequests");
    app.post("/foods", verifyToken, async(req, res) => {
        const body = req.body;
        const donator = {
            name: req.user.name || "",
            email: req.user.email,
            photoURL: req.user.photoURL || "https://i.ibb.co/hFLBkyBD/1j.webp",
            uid: req.user.uid,
        };

        const newFood = {
            ...body,
            expireDate: body.expireDate ? new Date(body.expireDate) : null,
            food_status: "Available",
            donator,
            createdAt: new Date(),
        };
        const result = await foodsCollection.insertOne(newFood);
        res.send(result);
    });

    app.post("/food-requests", verifyToken, async(req, res) => {
        try {
            const { foodId, location, reason, contact } = req.body;

            if (!foodId || !location || !reason || !contact) {
                return res.status(400).send({ message: "Missing required fields" });
            }

            const requestDoc = {
                foodId: new ObjectId(foodId),
                location,
                reason,
                contact,
                status: "pending",
                user: {
                    email: req.user.email,
                    name: req.user.name,
                    photoURL: req.user.photoURL,
                    uid: req.user.uid,
                },
                createdAt: new Date(),
            };

            const result = await foodRequestsCollection.insertOne(requestDoc);
            console.log("Inserted Request:", result.insertedId);
            res.send({ success: true, insertedId: result.insertedId });
        } catch (error) {
            console.error(error);
            res.status(500).send({ message: "Server error" });
        }
    });

    app.get("/my-food-requests", verifyToken, async(req, res) => {
        const email = req.user.email;
        const requests = await foodRequestsCollection.aggregate([
            { $match: { "user.email": email } },
            {
                $lookup: {
                    from: "foods",
                    localField: "foodId",
                    foreignField: "_id",
                    as: "food"
                }
            },
            {
                $unwind: {
                    path: "$food",
                    preserveNullAndEmptyArrays: true
                }
            },
            { $sort: { createdAt: -1 } }
        ]).toArray();
        res.send(requests);
    });

    app.get("/available-foods", async(req, res) => {
        const foods = await foodsCollection
            .find({ food_status: "Available" })
            .sort({ expireDate: 1 })
            .toArray();
        res.send(foods);
    });

    app.get("/foods", async(req, res) => {
        const foods = await foodsCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.send(foods);
    });

    app.get("/foods/:id", async(req, res) => {
        const id = req.params.id;
        const food = await foodsCollection.findOne({ _id: new ObjectId(id) });
        res.send(food);
    });

    const { ObjectId } = require("mongodb");
    app.get("/available-foods/:id", async(req, res) => {
        try {
            const id = req.params.id;
            const food = await foodsCollection.findOne({ _id: new ObjectId(id) });
            if (!food) {
                return res.status(404).send({ message: "Food not found" });
            }
            res.send(food);
        } catch (err) {
            console.error(err);
            res.status(500).send({ message: "Server Error" });
        }
    });

    app.get("/my-foods", verifyToken, async(req, res) => {
        const email = req.user.email;

        const foods = await foodsCollection
            .find({ "donator.email": email })
            .sort({ createdAt: -1 })
            .toArray();
        res.send(foods);
    });

    app.get("/food-requests/:foodId", verifyToken, async(req, res) => {
        const foodId = req.params.foodId;
        const food = await foodsCollection.findOne({ _id: new ObjectId(foodId) });
        if (!food) return res.status(404).send({ message: "Food not found" });

        if (food.donator.email !== req.user.email)
            return res.status(403).send({ message: "Forbidden" });
        const requests = await foodRequestsCollection
            .find({ foodId: new ObjectId(foodId) })
            .sort({ createdAt: -1 })
            .toArray();
        res.send(requests);
    });


    app.put("/foods/:id", verifyToken, async(req, res) => {
        const id = req.params.id;
        const body = req.body;
        const existingFood = await foodsCollection.findOne({ _id: new ObjectId(id) });
        if (!existingFood) {
            return res.status(404).send({ message: "Food Not Found" });
        }
        if (existingFood.donator.email !== req.user.email) {
            return res.status(403).send({ message: "Forbidden-Not Your Food" });
        }
        const { _id, donator, ...updateFields } = body;
        const updatedDoc = {
            $set: {
                ...updateFields,
                expireDate: body.expireDate ? new Date(body.expireDate) : existingFood.expireDate,
                updatedAt: new Date(),
            },
        };
        const result = await foodsCollection.updateOne({ _id: new ObjectId(id) },
            updatedDoc
        );
        res.send(result);
    });

    app.put("/food-requests/:id/accept", verifyToken, async(req, res) => {
        const requestId = req.params.id;
        const request = await foodRequestsCollection.findOne({ _id: new ObjectId(requestId) });
        if (!request) return res.status(404).send({ message: "Request not found" });
        const food = await foodsCollection.findOne({ _id: request.foodId });
        if (food.donator.email !== req.user.email)
            return res.status(403).send({ message: "Forbidden" });
        await foodRequestsCollection.updateOne({ _id: new ObjectId(requestId) }, { $set: { status: "accepted" } });
        await foodsCollection.updateOne({ _id: new ObjectId(request.foodId) }, { $set: { food_status: "donated" } });
        res.send({ success: true });
    });

    app.delete("/foods/:id", verifyToken, async(req, res) => {
        const id = req.params.id;
        const existingFood = await foodsCollection.findOne({ _id: new ObjectId(id) });
        if (!existingFood) {
            return res.status(404).send({ message: "Food Not Found" });
        }
        if (existingFood.donator.email !== req.user.email) {
            return res.status(403).send({ message: "Forbidden - Not Your Food" });
        }
        const result = await foodsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
    });
}

run().catch(console.dir);
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});