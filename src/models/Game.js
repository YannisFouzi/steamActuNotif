const mongoose = require("mongoose");

const GameSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  logoUrl: {
    type: String,
  },
  lastNewsTimestamp: {
    type: Number,
    default: 0,
  },
  lastUpdateTimestamp: {
    type: Number,
    default: 0,
  },
  // Liste des utilisateurs qui suivent ce jeu
  followers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Index pour optimiser les recherches par appId
GameSchema.index({ appId: 1 });

module.exports = mongoose.model("Game", GameSchema);
