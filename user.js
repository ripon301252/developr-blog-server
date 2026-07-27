// user Schema
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    photoURL: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,   // createdAt, updatedAt
    versionKey: false,  // ❌ removes __v
  }
);

// model
const User = mongoose.model("User", userSchema);

// post
app.post("/users", async (req, res) => {
  try {
    const { name, email, photoURL } = req.body;

    if (!email) {
      return res.status(400).send({ message: "Email required" });
    }

    const user = await User.findOneAndUpdate(
      { email }, // 🔥 email দিয়ে match
      {
        $set: { name, photoURL },
      },
      {
        upsert: true, // না থাকলে create
        new: true, // updated doc return
      },
    );

    res.send({
      success: true,
      user,
    });
  } catch (err) {
    res.status(500).send({
      success: false,
      message: "DB error",
    });
  }
});
