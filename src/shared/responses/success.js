const sendSuccessResponse = (res, message = "Success", data = null, meta = null, statusCode = 200) => {
    res.status(statusCode).json({
        success: true,
        statusCode,
        message,
        data,
        meta,
    })
}

module.exports = { sendSuccessResponse }