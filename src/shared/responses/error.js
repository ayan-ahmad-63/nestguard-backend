const sendErrorResponse = (res, message = "Error", errors = [], statusCode = 500) => {
    res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        errors
    })
}

module.exports = { sendErrorResponse }