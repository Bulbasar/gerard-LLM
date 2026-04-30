const { Sequelize, DataTypes } = require("sequelize");

// 🔥 MYSQL CONNECTION
const sequelize = new Sequelize("use_gpt", "root", "", {
  host: "localhost",
  dialect: "mysql",
  logging: (msg) => console.log("[SQL]", msg),

  // ✅ FORCE PH TIMEZONE (Sequelize level)
  timezone: "+08:00",
});

/**
 * SESSION TABLE
 */
const Session = sequelize.define("Session", {
  id: {
    type: DataTypes.CHAR(36),
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },

  sessionId: {
    type: DataTypes.CHAR(36), // UUID instead of string
    allowNull: false,
    unique: true,
  },
});

/**
 *  MESSAGE TABLE
 */
const Message = sequelize.define("Message", {
  id: {
    type: DataTypes.CHAR(36),
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },

  sessionId: {
    type: DataTypes.CHAR(36),
    allowNull: false,
  },

  role: {
    type: DataTypes.ENUM("user", "assistant"),
    allowNull: false,
  },

  content: {
    type: DataTypes.TEXT("long"),
    allowNull: false,
  },
});

/**
 *  TOKEN TABLE (REAL STREAM LOGGING)
 */
const MessageToken = sequelize.define("message_token", {
  id: {
    type: DataTypes.CHAR(36),
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },

  messageId: {
    type: DataTypes.CHAR(36),
    allowNull: false,
  },

  token: {
    type: DataTypes.TEXT,
    allowNull: false,
  },

  index: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
});

/**
 *  USER MEMORY
 */
const UserMemory = sequelize.define("user_memory", {
  id: {
    type: DataTypes.CHAR(36),
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },

  sessionId: {
    type: DataTypes.CHAR(36),
    allowNull: false,
  },

  key: {
    type: DataTypes.STRING, // e.g. "name", "preference"
    allowNull: false,
  },

  value: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
});
/**
 *  ASSOCIATIONS (IMPORTANT PART)
 *
 * One Session → Many Messages
 */
Session.hasMany(Message, {
  foreignKey: "sessionId",
  sourceKey: "sessionId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

Message.belongsTo(Session, {
  foreignKey: "sessionId",
  targetKey: "sessionId",
});

//  NEW RELATION: Message → Tokens
Message.hasMany(MessageToken, {
  foreignKey: "messageId",
  sourceKey: "id",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

MessageToken.belongsTo(Message, {
  foreignKey: "messageId",
  targetKey: "id",
});

/**
 * INIT DB (AUTO ALTER = DEV MIGRATION)
 */
async function initDB() {
  try {
    await sequelize.authenticate();
    console.log("✅ DB Connected");

    // ✅ FORCE MYSQL SESSION TIMEZONE
    await sequelize.query("SET time_zone = '+08:00'");

    await sequelize.sync({ alter: true });
    console.log("🛠️ DB Synced (ALTER MODE ENABLED)");
  } catch (err) {
    console.error("❌ DB ERROR:", err);
  }
}

module.exports = {
  sequelize,
  Session,
  Message,
  MessageToken,
  UserMemory,
  initDB,
};
